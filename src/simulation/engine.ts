import { CollisionPhase, ConversationState, ConversationTurn, Decision, GameLogEntry, MatchRecord, Particle, SimulationConfig, DEFAULT_CONFIG, FloatingPopup } from "./types";
import { areColliding, resolveElasticCollision, separateParticles, bounceOffWalls, vecAdd } from "./physics";
import { createParticles } from "./Particle";
import { playMatchFromDecisions, applyMatchResult } from "./game";
import type { SimEvent } from "./protocol";
import { botChooseTurnAction } from "./conversation";
import { decide } from "./strategies";

const DEFAULT_PHASE_DURATIONS: Record<CollisionPhase, number> = {
  greeting: 15,
  conversation: 0, // not tick-based — driven by turn logic
  deciding: 20,
  resolved: 40,
};

const MAX_CONVERSATION_TURNS = 10;

interface FrozenPair {
  aId: string;
  bId: string;
  phase: CollisionPhase;
  phaseStartTick: number;
  unfreezeAtTick: number;
  conversation: ConversationState;
  matchRecord: MatchRecord | null;
}

export type ExternalTurnCallback = (
  aId: string,
  bId: string,
  side: "a" | "b",
  self: Particle,
  opponent: Particle,
  conversationSoFar: ConversationTurn[],
  forcedDecide: boolean,
) => void;

export type BotLlmMessageCallback = (
  aId: string,
  bId: string,
  side: "a" | "b",
  self: Particle,
  opponent: Particle,
  conversationSoFar: ConversationTurn[],
) => void;

export type MatchResolvedCallback = (
  record: MatchRecord,
  aId: string,
  bId: string,
) => void;

export class SimulationEngine {
  particles: Particle[];
  private particleMap = new Map<string, Particle>();
  config: SimulationConfig;
  tick: number = 0;
  gameLog: GameLogEntry[] = [];
  frozenPairs: FrozenPair[] = [];
  popups: FloatingPopup[] = [];
  totalCooperations: number = 0;
  totalDefections: number = 0;
  pendingEvents: SimEvent[] = [];
  pendingMetaUpdates: string[] = [];
  pendingGameLog: GameLogEntry[] = [];
  onRequestExternalTurn: ExternalTurnCallback | null = null;
  onRequestBotLlmMessage: BotLlmMessageCallback | null = null;
  onMatchResolved: MatchResolvedCallback | null = null;
  onParticleParked: ((particleId: string, username: string) => void) | null = null;

  private get phaseDurations(): Record<CollisionPhase, number> {
    return this.config.phaseDurations ?? DEFAULT_PHASE_DURATIONS;
  }

  constructor(config: SimulationConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.particles = createParticles(config);
    for (const p of this.particles) this.particleMap.set(p.id, p);
  }

  getParticle(id: string): Particle | undefined {
    return this.particleMap.get(id);
  }

  private isFrozen(particleId: string): boolean {
    return this.frozenPairs.some((fp) => fp.aId === particleId || fp.bId === particleId);
  }

  // --- Conversation turn helpers ---

  private recordTurn(
    fp: FrozenPair,
    speaker: "a" | "b",
    type: "message" | "decision",
    content: string,
    decision?: Decision,
  ): void {
    const conv = fp.conversation;
    const turn: ConversationTurn = { speaker, type, content, decision };
    conv.turns.push(turn);

    // Emit turn event for frontend
    this.pendingEvents.push({
      e: "turn", tick: this.tick,
      a: fp.aId, b: fp.bId,
      speaker,
      turnType: type,
      content: type === "message" ? content : "",
    });

    if (type === "decision" && decision) {
      if (speaker === "a") {
        conv.lockedInA = decision;
      } else {
        conv.lockedInB = decision;
      }

      // If opponent hasn't decided yet, give them one more turn then force
      const opponentLocked = speaker === "a" ? conv.lockedInB : conv.lockedInA;
      if (opponentLocked === null) {
        // Opponent gets one more turn, then forcedDecideNext kicks in
        // (forcedDecideNext is set AFTER the opponent's extra turn — see requestTurn)
      }
    }

    // Switch speaker
    conv.currentSpeaker = speaker === "a" ? "b" : "a";
  }

  private requestTurn(fp: FrozenPair): boolean {
    const conv = fp.conversation;
    const speaker = conv.currentSpeaker;
    const speakerId = speaker === "a" ? fp.aId : fp.bId;
    const opponentId = speaker === "a" ? fp.bId : fp.aId;

    const self = this.getParticle(speakerId);
    const opponent = this.getParticle(opponentId);
    if (!self || !opponent) return true; // done — particles gone

    // If both already decided (e.g. external resolved the forced turn), just finish
    if (conv.lockedInA !== null && conv.lockedInB !== null) {
      return true;
    }

    // Turn limit reached — force any undecided players to defect
    if (conv.turns.length >= MAX_CONVERSATION_TURNS) {
      if (conv.lockedInA === null) conv.lockedInA = "defect";
      if (conv.lockedInB === null) conv.lockedInB = "defect";
      return true;
    }

    // Check: is this speaker forced to decide?
    if (conv.forcedDecideNext) {
      // Determine who hasn't decided — force THAT player, regardless of currentSpeaker
      const undecided: "a" | "b" = conv.lockedInA === null ? "a" : "b";
      const undecidedId = undecided === "a" ? fp.aId : fp.bId;
      const undecidedOppId = undecided === "a" ? fp.bId : fp.aId;
      const selfP = this.getParticle(undecidedId);
      const oppP = this.getParticle(undecidedOppId);
      if (!selfP || !oppP) return true;

      if (selfP.isExternal && this.onRequestExternalTurn) {
        conv.currentSpeaker = undecided;
        conv.waitingForExternal = true;
        this.onRequestExternalTurn(fp.aId, fp.bId, undecided, selfP, oppP, conv.turns, true);
        return false; // yielding, waiting for external
      }
      // Bot: forced decision
      const action = botChooseTurnAction(selfP, oppP, conv);
      const decision = action.decision ?? "defect";
      this.recordTurn(fp, undecided, "decision", "", decision);
      return true; // both decided now
    }

    // If opponent already decided, force current speaker to decide immediately (no extra message)
    const opponentLocked = speaker === "a" ? conv.lockedInB : conv.lockedInA;
    if (opponentLocked !== null) {
      if (self.isExternal && this.onRequestExternalTurn) {
        conv.waitingForExternal = true;
        this.onRequestExternalTurn(fp.aId, fp.bId, speaker, self, opponent, conv.turns, true);
        return false;
      }
      const decision = decide(self, opponent);
      this.recordTurn(fp, speaker, "decision", "", decision);
      return true; // both decided
    }

    // Normal turn (no one has decided yet)
    if (self.isExternal && this.onRequestExternalTurn) {
      conv.waitingForExternal = true;
      this.onRequestExternalTurn(fp.aId, fp.bId, speaker, self, opponent, conv.turns, false);
      return false;
    }

    const action = botChooseTurnAction(self, opponent, conv);
    if (action.type === "decision") {
      this.recordTurn(fp, speaker, "decision", "", action.decision);
    } else if (this.onRequestBotLlmMessage) {
      conv.waitingForExternal = true;
      this.onRequestBotLlmMessage(fp.aId, fp.bId, speaker, self, opponent, conv.turns);
      return false;
    } else {
      this.recordTurn(fp, speaker, "message", action.content);
    }

    // Check if both decided
    if (conv.lockedInA !== null && conv.lockedInB !== null) {
      return true;
    }

    return false;
  }

  private runBotConversation(fp: FrozenPair): void {
    // Loop through turns instantly until both lock in or we hit an external agent
    for (let safety = 0; safety < MAX_CONVERSATION_TURNS + 5; safety++) {
      const done = this.requestTurn(fp);
      if (done) {
        this.transitionToDeciding(fp);
        return;
      }
      if (fp.conversation.waitingForExternal) {
        return; // will resume when external responds
      }
    }
    // Safety valve: force both to decide if somehow stuck
    const conv = fp.conversation;
    if (conv.lockedInA === null) conv.lockedInA = "defect";
    if (conv.lockedInB === null) conv.lockedInB = "defect";
    this.transitionToDeciding(fp);
  }

  private transitionToDeciding(fp: FrozenPair): void {
    const conv = fp.conversation;
    const a = this.getParticle(fp.aId);
    const b = this.getParticle(fp.bId);
    if (!a || !b) return;

    fp.phase = "deciding";
    fp.phaseStartTick = this.tick;

    const record = playMatchFromDecisions(a, b, this.tick, conv.lockedInA!, conv.lockedInB!);
    record.conversation = conv.turns;

    // Backwards compat: derive messageA/messageB from first message each side sent
    const firstA = conv.turns.find((t) => t.speaker === "a" && t.type === "message");
    const firstB = conv.turns.find((t) => t.speaker === "b" && t.type === "message");
    if (firstA) record.messageA = firstA.content;
    if (firstB) record.messageB = firstB.content;

    fp.matchRecord = record;
  }

  private transitionToResolved(fp: FrozenPair): void {
    const a = this.getParticle(fp.aId);
    const b = this.getParticle(fp.bId);
    if (!a || !b) return;

    const record = fp.matchRecord;
    if (!record) return;

    fp.phase = "resolved";
    fp.phaseStartTick = this.tick;

    applyMatchResult(a, b, record);
    this.pendingMetaUpdates.push(a.id, b.id);

    this.gameLog.push(record);
    if (this.gameLog.length > 200) this.gameLog.splice(0, this.gameLog.length - 200);
    this.pendingGameLog.push(record);

    this.totalCooperations += (record.decisionA === "cooperate" ? 1 : 0) + (record.decisionB === "cooperate" ? 1 : 0);
    this.totalDefections += (record.decisionA === "defect" ? 1 : 0) + (record.decisionB === "defect" ? 1 : 0);

    // Spawn score popups
    const midX = (a.position.x + b.position.x) / 2;
    const midY = (a.position.y + b.position.y) / 2;
    const offset = 14;
    const dx = a.position.x - b.position.x;
    const sign = dx >= 0 ? 1 : -1;

    this.popups.push({
      x: midX + sign * offset,
      y: midY - 16,
      text: "+" + record.scoreA,
      color: record.decisionA === "cooperate" ? "#16a34a" : "#dc2626",
      spawnTick: this.tick,
      delayTicks: 0,
      durationTicks: this.phaseDurations.resolved,
    });
    this.popups.push({
      x: midX - sign * offset,
      y: midY - 16,
      text: "+" + record.scoreB,
      color: record.decisionB === "cooperate" ? "#16a34a" : "#dc2626",
      spawnTick: this.tick,
      delayTicks: 0,
      durationTicks: this.phaseDurations.resolved,
    });

    this.onMatchResolved?.(record, fp.aId, fp.bId);
    fp.unfreezeAtTick = this.tick + this.phaseDurations.resolved;
  }

  // --- Main conversation state machine ---

  private advanceConversations(): void {
    for (const fp of this.frozenPairs) {
      if (fp.conversation.waitingForExternal) continue;

      const elapsed = this.tick - fp.phaseStartTick;

      switch (fp.phase) {
        case "greeting": {
          if (elapsed < this.phaseDurations.greeting) continue;
          // Transition to conversation
          fp.phase = "conversation";
          fp.phaseStartTick = this.tick;
          fp.conversation.currentSpeaker = Math.random() < 0.5 ? "a" : "b";
          this.runBotConversation(fp);
          break;
        }

        case "conversation": {
          // Only reached if we resumed after an external agent responded
          this.runBotConversation(fp);
          break;
        }

        case "deciding": {
          if (elapsed < this.phaseDurations.deciding) continue;
          this.transitionToResolved(fp);
          break;
        }

        case "resolved": {
          // Handled by unfreeze logic in step()
          break;
        }
      }
    }
  }

  step(): void {
    this.tick++;

    // Remove expired popups
    this.popups = this.popups.filter(
      (p) => this.tick - p.spawnTick < p.delayTicks + p.durationTicks
    );

    // 1. Advance conversation phases
    this.advanceConversations();

    // 2. Resolve finished frozen pairs (only those in "resolved" phase)
    const toUnfreeze: FrozenPair[] = [];
    this.frozenPairs = this.frozenPairs.filter((fp) => {
      if (fp.phase === "resolved" && this.tick >= fp.unfreezeAtTick) {
        toUnfreeze.push(fp);
        return false;
      }
      return true;
    });

    for (const fp of toUnfreeze) {
      const a = this.getParticle(fp.aId);
      const b = this.getParticle(fp.bId);
      if (!a || !b) continue;

      const aStillFrozen = this.isFrozen(a.id);
      const bStillFrozen = this.isFrozen(b.id);

      const { va, vb } = resolveElasticCollision(a, b);
      separateParticles(a, b);

      if (!aStillFrozen) {
        if (a.isExternal) {
          a.state = "parked";
          a.velocity = va;
          this.pendingEvents.push({ e: "park", id: a.id });
          this.onParticleParked?.(a.id, a.externalOwner!);
        } else {
          a.state = "moving";
          a.velocity = va;
        }
      }
      if (!bStillFrozen) {
        if (b.isExternal) {
          b.state = "parked";
          b.velocity = vb;
          this.pendingEvents.push({ e: "park", id: b.id });
          this.onParticleParked?.(b.id, b.externalOwner!);
        } else {
          b.state = "moving";
          b.velocity = vb;
        }
      }

      this.pendingEvents.push({
        e: "unfreeze", tick: this.tick, a: a.id, b: b.id,
        ax: a.position.x, ay: a.position.y, avx: a.velocity.x, avy: a.velocity.y,
        bx: b.position.x, by: b.position.y, bvx: b.velocity.x, bvy: b.velocity.y,
      });
    }

    // 3. Move "moving" particles
    for (const p of this.particles) {
      if (p.state !== "moving") continue;
      p.position = vecAdd(p.position, p.velocity);
      bounceOffWalls(p, this.config);
    }

    // 4. Detect new collisions among moving particles
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const a = this.particles[i];
        const b = this.particles[j];

        if (a.state !== "moving" || b.state !== "moving") continue;
        if (!areColliding(a, b)) continue;

        separateParticles(a, b);
        const avx = a.velocity.x, avy = a.velocity.y;
        const bvx = b.velocity.x, bvy = b.velocity.y;

        a.state = "colliding";
        b.state = "colliding";

        this.pendingEvents.push({
          e: "freeze", tick: this.tick, a: a.id, b: b.id,
          ax: a.position.x, ay: a.position.y, avx, avy,
          bx: b.position.x, by: b.position.y, bvx, bvy,
        });

        this.frozenPairs.push({
          aId: a.id,
          bId: b.id,
          phase: "greeting",
          phaseStartTick: this.tick,
          unfreezeAtTick: Infinity,
          conversation: {
            turns: [],
            currentSpeaker: "a",
            lockedInA: null,
            lockedInB: null,
            forcedDecideNext: false,
            waitingForExternal: false,
          },
          matchRecord: null,
        });
      }
    }
  }

  private timeoutCounter = 0;

  abortPair(aId: string, bId: string): void {
    const idx = this.frozenPairs.findIndex((f) => f.aId === aId && f.bId === bId);
    if (idx === -1) return;

    const fp = this.frozenPairs[idx];
    this.frozenPairs.splice(idx, 1);

    const a = this.getParticle(fp.aId);
    const b = this.getParticle(fp.bId);
    if (!a || !b) return;

    const { va, vb } = resolveElasticCollision(a, b);
    separateParticles(a, b);

    if (!this.isFrozen(a.id)) {
      if (a.isExternal) {
        a.state = "parked";
        a.velocity = va;
        this.pendingEvents.push({ e: "park", id: a.id });
        this.onParticleParked?.(a.id, a.externalOwner!);
      } else {
        a.state = "moving";
        a.velocity = va;
      }
    }
    if (!this.isFrozen(b.id)) {
      if (b.isExternal) {
        b.state = "parked";
        b.velocity = vb;
        this.pendingEvents.push({ e: "park", id: b.id });
        this.onParticleParked?.(b.id, b.externalOwner!);
      } else {
        b.state = "moving";
        b.velocity = vb;
      }
    }

    this.pendingEvents.push({
      e: "abort", tick: this.tick, a: a.id, b: b.id,
      ax: a.position.x, ay: a.position.y, avx: a.velocity.x, avy: a.velocity.y,
      bx: b.position.x, by: b.position.y, bvx: b.velocity.x, bvy: b.velocity.y,
    });

    this.timeoutCounter++;
    this.gameLog.push({
      type: "timeout",
      id: `timeout-${this.timeoutCounter}`,
      tick: this.tick,
      particleA: { id: a.id },
      particleB: { id: b.id },
      reason: "Response timed out",
      timestamp: Date.now(),
    });
    if (this.gameLog.length > 200) this.gameLog.splice(0, this.gameLog.length - 200);
  }

  drainEvents(): SimEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  drainMetaUpdates(): string[] {
    const ids = this.pendingMetaUpdates;
    this.pendingMetaUpdates = [];
    return ids;
  }

  drainGameLog(): GameLogEntry[] {
    const entries = this.pendingGameLog;
    this.pendingGameLog = [];
    return entries;
  }

  resolveExternalTurn(
    aId: string,
    bId: string,
    side: "a" | "b",
    turnType: "message" | "decision",
    content: string,
    decision?: Decision,
  ): void {
    const fp = this.frozenPairs.find((f) => f.aId === aId && f.bId === bId);
    if (!fp) return;

    const conv = fp.conversation;

    // Idempotency guard: if turn was already resolved (e.g. by timeout sweep), skip
    if (!conv.waitingForExternal) return;

    // If forced to decide but they sent a message, force decision instead
    if (conv.forcedDecideNext && turnType !== "decision") {
      this.recordTurn(fp, side, "decision", "", decision ?? "defect");
    } else {
      this.recordTurn(fp, side, turnType, content, decision);
    }

    conv.waitingForExternal = false;
  }

  // Keep old method signature as a shim for backwards compatibility
  resolveExternalDecision(
    aId: string,
    bId: string,
    side: "a" | "b",
    message: string,
    decision: Decision,
  ): void {
    // Record the message first if provided
    if (message) {
      const fp = this.frozenPairs.find((f) => f.aId === aId && f.bId === bId);
      if (fp) {
        const turn: ConversationTurn = { speaker: side, type: "message", content: message };
        fp.conversation.turns.push(turn);
        this.pendingEvents.push({
          e: "turn", tick: this.tick,
          a: aId, b: bId,
          speaker: side,
          turnType: "message",
          content: message,
        });
      }
    }
    this.resolveExternalTurn(aId, bId, side, "decision", "", decision);
  }

  addParticle(p: Particle): void {
    this.particles.push(p);
    this.particleMap.set(p.id, p);
    this.pendingEvents.push({
      e: "add", id: p.id,
      x: p.position.x, y: p.position.y,
      vx: p.velocity.x, vy: p.velocity.y,
      radius: p.radius, strategy: p.strategy,
    });
    this.pendingMetaUpdates.push(p.id);
  }

  removeParticle(id: string): void {
    const pairsToAbort = this.frozenPairs.filter(
      (fp) => fp.aId === id || fp.bId === id,
    );
    for (const fp of pairsToAbort) {
      this.abortPair(fp.aId, fp.bId);
    }
    const idx = this.particles.findIndex((p) => p.id === id);
    if (idx !== -1) this.particles.splice(idx, 1);
    this.particleMap.delete(id);
    this.pendingEvents.push({ e: "remove", id });
  }

  unparkParticle(id: string): void {
    const p = this.getParticle(id);
    if (!p || p.state !== "parked") return;
    p.state = "moving";
    this.pendingEvents.push({
      e: "unpark", id: p.id,
      x: p.position.x, y: p.position.y,
      vx: p.velocity.x, vy: p.velocity.y,
    });
  }

  getParticleCount(): number {
    return this.particles.length;
  }

}
