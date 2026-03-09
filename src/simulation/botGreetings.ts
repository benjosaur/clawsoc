/**
 * Per-bot greeting and betrayal templates, grounded in real quotes
 * and adapted to fit a Prisoner's Dilemma greeting context.
 *
 * Key = particle id (historical name from types.ts).
 * {opponent} placeholder is replaced with the opponent's name at runtime.
 */

export const BOT_GREETINGS: Record<string, string[]> = {
  // ─── ALWAYS COOPERATE ──────────────────────────────────────────────
  Gandhi: [
    "An eye for an eye leaves us both with nothing, {opponent}.",
    "The weak can never forgive — forgiveness is strength, {opponent}.",
    "Be the change you wish to see in this game, {opponent}.",
    "Nonviolence is the greatest force I know, {opponent}.",
  ],
  Teresa: [
    "If you judge people, you have no time to love them, {opponent}.",
    "Not all of us can do great things, but we can do small things with love, {opponent}.",
    "Spread love everywhere you go, {opponent}. Let no one leave without being happier.",
    "I see the good in you, {opponent}.",
  ],
  Nightingale: [
    "I attribute my success to this — I never gave an excuse, {opponent}.",
    "The very first requirement is that we should be kind, {opponent}.",
    "Let us never consider ourselves finished, {opponent}.",
    "I will tend to this encounter with care, {opponent}.",
  ],
  Rogers: [
    "You've made this day a special day, {opponent}, just by being you.",
    "I like you just the way you are, {opponent}.",
    "You are my neighbor, {opponent}. Won't you be mine?",
    "There's no one else quite like you, {opponent}.",
  ],
  Schweitzer: [
    "The purpose of life is to serve and show compassion, {opponent}.",
    "Constant kindness can accomplish much, {opponent}.",
    "I have reverence for all life, {opponent} — yours included.",
    "Example is not the main thing in influencing others, {opponent}. It is the only thing.",
  ],
  Tubman: [
    "Every great dream begins with a dreamer, {opponent}.",
    "I freed myself first, {opponent} — now I help others.",
    "I never ran my train off the track, {opponent}. And I never lost a passenger.",
    "Liberty or death, {opponent} — and I choose to give you liberty.",
  ],
  Mandela: [
    "No one is born hating another, {opponent}.",
    "I learned that courage is not the absence of fear, {opponent}.",
    "It always seems impossible until it is done, {opponent}.",
    "A good head and a good heart are a formidable combination, {opponent}.",
  ],
  Tutu: [
    "My humanity is bound up in yours, {opponent}.",
    "Do your little bit of good where you are, {opponent}.",
    "We are made for goodness, {opponent}. We are made for love.",
    "Without forgiveness there is no future, {opponent}.",
  ],
  Schindler: [
    "Whoever saves one life saves the entire world, {opponent}.",
    "I could have done more, {opponent}. I will always do more.",
    "Power is when we have every reason to act cruelly and we don't, {opponent}.",
    "I choose to help, {opponent}. Always.",
  ],
  Francis: [
    "Start by doing what is necessary, {opponent}, then what is possible.",
    "It is in giving that we receive, {opponent}.",
    "Lord, make me an instrument of your peace, {opponent}.",
    "Where there is hatred, let me sow love, {opponent}.",
  ],
  Tolstoy: [
    "Everyone thinks of changing the world, but no one changes themselves, {opponent}.",
    "If you want to be happy, {opponent}, be kind.",
    "The two most powerful warriors are patience and time, {opponent}.",
    "All happy encounters are alike, {opponent}.",
  ],
  Thoreau: [
    "I went to the woods to live deliberately, {opponent}.",
    "The price of anything is the amount of life you exchange for it, {opponent}.",
    "What lies before us are tiny matters, {opponent}, compared to what lies within.",
    "Goodness is the only investment that never fails, {opponent}.",
  ],
  Keller: [
    "Alone we can do so little, {opponent}. Together we can do so much.",
    "The best things in life are unseen — that is why we close our eyes, {opponent}.",
    "Optimism is the faith that leads to achievement, {opponent}.",
    "Keep your face to the sunshine, {opponent}.",
  ],
  Curie: [
    "Nothing in life is to be feared, only understood, {opponent}.",
    "I was taught that the way of progress is slow and painful, {opponent}.",
    "Be less curious about people and more curious about ideas, {opponent}.",
    "Life is not easy for any of us, {opponent}. But we must have perseverance.",
  ],
  Salk: [
    "The reward for a good deed is to have done it, {opponent}.",
    "I have had dreams and I have had nightmares, {opponent}. I overcame with dreams.",
    "There is no patent on cooperation, {opponent}. Could you patent the sun?",
    "Hope lies in dreams and in the courage to make them real, {opponent}.",
  ],
  Addams: [
    "The good we secure for ourselves is precarious until it is secured for all, {opponent}.",
    "Action is the only remedy to indifference, {opponent}.",
    "The essence of immorality is to make an exception of yourself, {opponent}.",
    "Social advance depends upon an ever-widening circle, {opponent}.",
  ],
  Barton: [
    "I may sometimes be willing to teach for nothing, {opponent}, but not to be idle.",
    "An institution is the lengthened shadow of one good soul, {opponent}.",
    "I offer you aid without question, {opponent}.",
    "I have an almost complete disregard of precedent, {opponent}. I go and do.",
  ],
  Lincoln: [
    "The better angels of our nature are listening, {opponent}.",
    "Do I not destroy my enemies when I make them friends, {opponent}?",
    "I am a slow walker, but I never walk back, {opponent}.",
    "Whatever you are, {opponent}, be a good one.",
  ],
  Buddha: [
    "Hatred is never ended by hatred, {opponent}. Only by love.",
    "In the end, only three things matter — how fully you lived and loved, {opponent}.",
    "Peace comes from within, {opponent}. Do not seek it without.",
    "You will not be punished for your anger, {opponent}, but by it.",
  ],
  Aesop: [
    "No act of kindness, however small, is ever wasted, {opponent}.",
    "Slow and steady wins the race, {opponent}.",
    "We often give our enemies the means of our own destruction, {opponent}.",
    "United we stand, {opponent}. Divided we fall.",
  ],

  // ─── ALWAYS DEFECT ─────────────────────────────────────────────────
  Judas: [
    "Everyone has a price, {opponent}. I found mine.",
    "A kiss can mean many things, {opponent}.",
    "Trust is just a word, {opponent}. Silver is real.",
    "What I do, I do quickly, {opponent}.",
  ],
  Brutus: [
    "It is not that I loved you less, {opponent}, but that I loved myself more.",
    "Sic semper tyrannis, {opponent}.",
    "Even friends must serve the greater good, {opponent}.",
    "Beware the Ides, {opponent}.",
  ],
  Nero: [
    "What an artist the world loses in me, {opponent}.",
    "I will play while everything burns, {opponent}.",
    "Rome answers to me, {opponent}. Not the other way around.",
    "All I ask for is your applause, {opponent}.",
  ],
  Machiavelli: [
    "Better you fear me than trust me, {opponent}.",
    "The ends always justify the means, {opponent}.",
    "Never attempt to win by force what can be won by deception, {opponent}.",
    "Men are so simple that a great deceiver will always find willing victims, {opponent}.",
  ],
  Borgia: [
    "Either Caesar or nothing, {opponent}.",
    "I seize what fortune offers, {opponent}. Every time.",
    "Good and evil are merely tools, {opponent}.",
    "Wine and ambition — I never refuse either, {opponent}.",
  ],
  Attila: [
    "There, where I have passed, the grass will never grow again, {opponent}.",
    "It is not enough that I succeed, {opponent}. Others must fail.",
    "I am the scourge of this game, {opponent}.",
    "Tremble, {opponent}. I have come.",
  ],
  Vlad: [
    "I like to make an example, {opponent}.",
    "Fear is the greatest weapon, {opponent}. I wield it well.",
    "I rule through terror, not through trust, {opponent}.",
    "The forest of stakes grows taller with each encounter, {opponent}.",
  ],
  Commodus: [
    "Are you not entertained, {opponent}?",
    "I am the emperor of this arena, {opponent}.",
    "The mob is on my side, {opponent}. Not yours.",
    "I will write my name in your ruin, {opponent}.",
  ],
  Rasputin: [
    "I have been poisoned, shot, and drowned, {opponent}. Still I rise.",
    "They will never destroy me, {opponent}.",
    "I see through you, {opponent}. I see everything.",
    "My influence cannot be broken, {opponent}.",
  ],
  Blackbeard: [
    "Let us see who is more terrible, {opponent}.",
    "I lit my beard on fire to frighten my enemies, {opponent}.",
    "Damnation seize your soul if you give me quarter, {opponent}.",
    "A pirate takes what a pirate wants, {opponent}.",
  ],
  Herod: [
    "I build monuments and destroy threats, {opponent}.",
    "A king does what he must to keep his crown, {opponent}.",
    "I trust no one, {opponent}. Not even my own blood.",
    "Power demands sacrifice, {opponent}. Yours.",
  ],
  Caligula: [
    "Let them hate, so long as they fear, {opponent}.",
    "Would that the world had but one neck, {opponent}.",
    "I am above the rules of this game, {opponent}.",
    "I do what I please, {opponent}. I am a god.",
  ],
  Torquemada: [
    "Mercy is weakness dressed in virtue, {opponent}.",
    "I seek only the truth, {opponent}. Your truth.",
    "Confess or suffer, {opponent}. Those are your choices.",
    "Purity demands sacrifice, {opponent}.",
  ],
  Quisling: [
    "I serve whoever holds the power, {opponent}.",
    "Loyalty is a luxury I cannot afford, {opponent}.",
    "I choose the winning side, {opponent}. Always.",
    "History will vindicate me, {opponent}.",
  ],
  Robespierre: [
    "Terror is nothing but swift and severe justice, {opponent}.",
    "The revolution has no friends, {opponent}.",
    "Virtue without terror is impotent, {opponent}.",
    "I do this for the people, {opponent}. Not for you.",
  ],
  Sulla: [
    "No friend ever served me, no enemy ever wronged me, whom I have not repaid, {opponent}.",
    "I wrote the proscription lists myself, {opponent}.",
    "Fortune favors Sulla, {opponent}. Not you.",
    "I retired undefeated, {opponent}. Can you say the same?",
  ],
  Caracalla: [
    "Let them live, so long as they pay, {opponent}.",
    "I extended citizenship so I could tax everyone, {opponent}.",
    "Brotherhood is a useful fiction, {opponent}.",
    "My baths are grand, but my mercy is not, {opponent}.",
  ],
  Domitian: [
    "Trust no one, {opponent}. Not even the senate.",
    "I catch flies, {opponent}. Imagine what I do to rivals.",
    "Paranoia has kept me alive, {opponent}.",
    "A good emperor rules through suspicion, {opponent}.",
  ],
  Crassus: [
    "Every man has his price, {opponent}. What is yours?",
    "I am the richest player in this game, {opponent}.",
    "I buy what I cannot conquer, {opponent}.",
    "Wealth is the truest form of power, {opponent}.",
  ],
  Sejanus: [
    "I whisper in the emperor's ear, {opponent}.",
    "The man behind the throne holds the real power, {opponent}.",
    "Trust me, {opponent}. Everyone else does — until it's too late.",
    "I rose from nothing, {opponent}. I will not stop now.",
  ],

  // ─── TIT FOR TAT ──────────────────────────────────────────────────
  Hammurabi: [
    "The code is simple — you get what you give, {opponent}.",
    "An eye for an eye, a tooth for a tooth, {opponent}.",
    "Justice must be inscribed in stone, {opponent}.",
    "Let the punishment fit the crime, {opponent}.",
  ],
  Aristotle: [
    "We are what we repeatedly do, {opponent}. Excellence is a habit.",
    "The roots of education are bitter, but the fruit is sweet, {opponent}.",
    "Knowing yourself is the beginning of all wisdom, {opponent}.",
    "Quality is not an act, {opponent}. It is a habit.",
  ],
  Solomon: [
    "The wise man listens to counsel, {opponent}.",
    "A soft answer turns away wrath, {opponent}.",
    "As iron sharpens iron, so one person sharpens another, {opponent}.",
    "To everything there is a season, {opponent}.",
  ],
  Aurelius: [
    "The best revenge is to be unlike those who cause injury, {opponent}.",
    "You have power over your mind, not outside events, {opponent}.",
    "Waste no more time arguing about what a good player should be, {opponent}. Be one.",
    "The impediment to action advances action, {opponent}.",
  ],
  Solon: [
    "Know thyself, {opponent}. I know myself.",
    "Laws are like spider webs — they catch the small, {opponent}.",
    "Count no player happy until the game is done, {opponent}.",
    "I make no law that I myself would not obey, {opponent}.",
  ],
  Socrates: [
    "The unexamined game is not worth playing, {opponent}.",
    "I know that I know nothing, {opponent}. And that is my advantage.",
    "True wisdom comes from knowing you know nothing, {opponent}.",
    "I cannot teach you, {opponent}. I can only make you think.",
  ],
  Cicero: [
    "A room without books is like a body without a soul, {opponent}.",
    "The safety of the people shall be the highest law, {opponent}.",
    "To be ignorant of the past is to remain a child, {opponent}.",
    "Justice renders to each their due, {opponent}.",
  ],
  Pericles: [
    "What you leave behind is not what is engraved in stone, {opponent}.",
    "We do not imitate, {opponent}. We are a model to others.",
    "Freedom is the sure possession of those who have courage, {opponent}.",
    "The whole earth is the sepulchre of famous men, {opponent}.",
  ],
  Franklin: [
    "An investment in knowledge pays the best interest, {opponent}.",
    "Well done is better than well said, {opponent}.",
    "We must hang together, {opponent}, or we shall surely hang separately.",
    "A penny saved is a penny earned, {opponent}.",
  ],
  Locke: [
    "No man's knowledge can go beyond his experience, {opponent}.",
    "We are like chameleons — we take our hue from those around us, {opponent}.",
    "The end of law is not to restrict but to preserve freedom, {opponent}.",
    "Where there is no property, there is no injustice, {opponent}.",
  ],
  Montesquieu: [
    "Power should be a check to power, {opponent}.",
    "Liberty is the right to do what the law permits, {opponent}.",
    "Injustice anywhere is a threat to justice everywhere, {opponent}.",
    "The tyranny of a prince is not so dangerous as the apathy of citizens, {opponent}.",
  ],
  Justinian: [
    "Justice is the constant purpose of rendering to each their due, {opponent}.",
    "The law must be clear, {opponent}. Ambiguity breeds injustice.",
    "I codified the rules so everyone knows where they stand, {opponent}.",
    "Live honestly, harm no one, give everyone their due, {opponent}.",
  ],
  Ashoka: [
    "I once conquered by war, {opponent}. Now I conquer by dharma.",
    "All men are my children, {opponent}.",
    "I have engraved my laws on pillars for all to see, {opponent}.",
    "Restraint in speech is the highest virtue, {opponent}.",
  ],
  Themistocles: [
    "I cannot play the fiddle, but I can make a small city great, {opponent}.",
    "Strike, but hear me first, {opponent}.",
    "The Athenians govern the Greeks, and I govern the Athenians, {opponent}.",
    "I read the situation, {opponent}. That is my strength.",
  ],
  Cincinnatus: [
    "I left my plow to serve, {opponent}. And I will return to it.",
    "Power is a duty, not a prize, {opponent}.",
    "I was given absolute power and gave it back, {opponent}.",
    "Serve when called, {opponent}. Then go home.",
  ],
  Confucius: [
    "Do not do to others what you would not have them do to you, {opponent}.",
    "Before you embark on revenge, {opponent}, dig two graves.",
    "The man who moves a mountain begins by carrying small stones, {opponent}.",
    "Real knowledge is to know the extent of one's ignorance, {opponent}.",
  ],
  Plato: [
    "Be kind, {opponent}, for everyone you meet is fighting a hard battle.",
    "The measure of a player is what they do with power, {opponent}.",
    "Wise men speak because they have something to say, {opponent}.",
    "Justice is the quality of the soul, {opponent}.",
  ],
  Seneca: [
    "Luck is what happens when preparation meets opportunity, {opponent}.",
    "We suffer more in imagination than in reality, {opponent}.",
    "Difficulties strengthen the mind, {opponent}, as labor does the body.",
    "It is not that we have a short game, {opponent}, but that we waste much of it.",
  ],
  Epictetus: [
    "It is not what happens to you, but how you react, {opponent}.",
    "First say to yourself what you would be, then do what you have to do, {opponent}.",
    "No man is free who is not master of himself, {opponent}.",
    "Make the best use of what is in your power, {opponent}.",
  ],
  Plutarch: [
    "What we achieve inwardly will change outer reality, {opponent}.",
    "The mind is not a vessel to be filled but a fire to be kindled, {opponent}.",
    "I write not histories but lives, {opponent}.",
    "Character is simply habit long continued, {opponent}.",
  ],

  // ─── RANDOM ────────────────────────────────────────────────────────
  Diogenes: [
    "I am looking for an honest player, {opponent}. Are you one?",
    "Stand out of my sunlight, {opponent}.",
    "I threw away my cup when I saw a child drinking with his hands, {opponent}.",
    "In a rich man's house there is no place to spit but in his face, {opponent}.",
  ],
  Byron: [
    "She walks in beauty, {opponent}, and I walk in chaos.",
    "The great art of life is sensation — to feel that we exist, {opponent}.",
    "I am mad, bad, and dangerous to know, {opponent}.",
    "There is pleasure in the pathless woods, {opponent}.",
  ],
  Casanova: [
    "I have always loved truth so passionately that I often invented it, {opponent}.",
    "The game of chance is the most honest game of all, {opponent}.",
    "Every encounter is an adventure, {opponent}.",
    "I am a free agent, {opponent}. I follow only my desire.",
  ],
  Caravaggio: [
    "Every painting is a fight, {opponent}. This is no different.",
    "I paint with light and shadow, {opponent}. You will see both.",
    "I am not a gentle soul, {opponent}. My art proves it.",
    "Beauty and violence walk hand in hand, {opponent}.",
  ],
  Wilde: [
    "I can resist everything except temptation, {opponent}.",
    "To live is the rarest thing, {opponent}. Most people merely exist.",
    "The only way to get rid of temptation is to yield to it, {opponent}.",
    "Be yourself, {opponent}. Everyone else is already taken.",
  ],
  Tesla: [
    "The present is theirs, {opponent}. The future is mine.",
    "I do not think you can name many great inventions made by married men, {opponent}.",
    "My brain is only a receiver, {opponent}. In the universe there is a core.",
    "Let the future tell the truth, {opponent}.",
  ],
  Dalí: [
    "I do not understand why, when I ask for a lobster, {opponent}, I am served coffee.",
    "Have no fear of perfection, {opponent}. You will never reach it.",
    "The only difference between me and a madman is I am not mad, {opponent}.",
    "Give me two hours a day and I'll give you the rest, {opponent}.",
  ],
  Poe: [
    "All that we see or seem is but a dream within a dream, {opponent}.",
    "I became insane, with long intervals of horrible sanity, {opponent}.",
    "Deep into that darkness peering, I stand here, {opponent}.",
    "Quoth the raven — nevermore, {opponent}.",
  ],
  Mozart: [
    "The music is not in the notes but in the silence between them, {opponent}.",
    "I pay no attention to anybody's praise or blame, {opponent}.",
    "Neither a lofty mind nor a great talent is needed — just play, {opponent}.",
    "I write music as naturally as a sow piddles, {opponent}.",
  ],
  Alcibiades: [
    "I change sides when the wind changes, {opponent}.",
    "Athens loves me, Sparta respects me, Persia welcomes me, {opponent}.",
    "I cut my dog's tail so they'd have something to talk about, {opponent}.",
    "I am whoever I need to be, {opponent}.",
  ],
  Houdini: [
    "No prison can hold me, {opponent}. No chain can bind me.",
    "What the eyes see and the ears hear, the mind believes, {opponent}.",
    "My mind is the key that sets me free, {opponent}.",
    "The secret to my magic is practice, {opponent}. Nothing more.",
  ],
  Paganini: [
    "I am not handsome, but when I play, {opponent}, they fall at my feet.",
    "I was once imprisoned for two years, {opponent}. I mastered the violin.",
    "They say I sold my soul, {opponent}. I say I sold tickets.",
    "One string is enough if you have the skill, {opponent}.",
  ],
  Joker: [
    "Why so serious, {opponent}?",
    "I'm an agent of chaos, {opponent}. And chaos is fair.",
    "Do I look like a guy with a plan, {opponent}?",
    "It's not about the points — it's about sending a message, {opponent}.",
  ],
  Rimbaud: [
    "I is another, {opponent}.",
    "Life is the farce we are all forced to endure, {opponent}.",
    "I turned silences and nights into words, {opponent}.",
    "I have stretched ropes from steeple to steeple, {opponent}. Garlands of stars.",
  ],
  Heraclitus: [
    "No man ever steps in the same river twice, {opponent}.",
    "Character is destiny, {opponent}.",
    "The road up and the road down are one and the same, {opponent}.",
    "Everything flows, {opponent}. Nothing is permanent except change.",
  ],
  Sappho: [
    "What is beautiful is good, {opponent}, and what is good will soon be beautiful.",
    "Love shook my heart like wind upon the mountain oaks, {opponent}.",
    "I do not know what to do — there are two minds in me, {opponent}.",
    "Evening star, you bring all that the dawn has scattered, {opponent}.",
  ],
  Baudelaire: [
    "I have cultivated my hysteria with joy and terror, {opponent}.",
    "The greatest trick the devil played was convincing the world he didn't exist, {opponent}.",
    "One should always be drunk, {opponent}. On wine, poetry, or virtue.",
    "There are moments of existence when time and space are more profound, {opponent}.",
  ],
  Nietzsche: [
    "What does not kill me makes me stranger, {opponent}.",
    "When you gaze into the abyss, {opponent}, the abyss gazes back.",
    "There are no facts, {opponent}. Only interpretations.",
    "I am dynamite, {opponent}.",
  ],
  Pythagoras: [
    "All is number, {opponent}.",
    "Do not say a little in many words, {opponent}, but a great deal in a few.",
    "There is geometry in the humming of the strings, {opponent}.",
    "Choose always the way that seems the best, {opponent}, however rough.",
  ],
  Nostradamus: [
    "I have seen what is to come, {opponent}. Have you?",
    "The stars foretell your choice, {opponent}.",
    "Great calamities and great cooperation — I have predicted both, {opponent}.",
    "The future is written, {opponent}. But you cannot read it.",
  ],

  // ─── GRUDGER ───────────────────────────────────────────────────────
  Hannibal: [
    "I will find a way, {opponent}, or I will make one.",
    "I swore an oath against my enemies, {opponent}. I do not forget.",
    "I crossed the Alps, {opponent}. Do not test my resolve.",
    "Rome trembled at my name, {opponent}.",
  ],
  Cato: [
    "Carthago delenda est, {opponent}. And so is betrayal.",
    "I speak plainly, {opponent}. I act plainly. Do not mistake that for weakness.",
    "I would rather be right than popular, {opponent}.",
    "I end every speech the same way, {opponent}. You will learn why.",
  ],
  Spartacus: [
    "I was born in chains, {opponent}. I do not yield easily.",
    "I am Spartacus, {opponent}. And I fight for the free.",
    "They trained me to fight, {opponent}. They should not have.",
    "A free man fights harder than a slave, {opponent}.",
  ],
  Joan: [
    "I am not afraid, {opponent}. I was born to do this.",
    "I would rather die than do something I know to be wrong, {opponent}.",
    "Act, and God will act, {opponent}.",
    "My voices tell me to be brave, {opponent}.",
  ],
  Leonidas: [
    "Come and take it, {opponent}.",
    "Return with your shield or on it, {opponent}.",
    "We will fight in the shade, {opponent}.",
    "Spartans never retreat, {opponent}. Spartans never surrender.",
  ],
  Boudica: [
    "I fight not for my kingdom but for my freedom, {opponent}.",
    "Win the battle or perish — that is what I will do, {opponent}.",
    "It is not as a queen that I fight, but as one of the people, {opponent}.",
    "We British are used to women commanders in war, {opponent}.",
  ],
  Saladin: [
    "I warn you against shedding blood and indulging in it, {opponent}.",
    "Beware of the blood you spill, {opponent}. It never sleeps.",
    "Victory is changing the hearts of your opponents, {opponent}.",
    "I would rather be merciful, {opponent}, but do not mistake mercy for weakness.",
  ],
  Geronimo: [
    "I was born on the prairies where the wind blew free, {opponent}.",
    "I was born free, {opponent}, and I intend to remain so.",
    "While I live, I fight, {opponent}.",
    "I cannot think that we are useless, {opponent}, or God would not have made us.",
  ],
  Cochise: [
    "I was at peace with the whites until they betrayed me, {opponent}.",
    "When I say I will fight, {opponent}, I do not lie.",
    "I am alone in the world, {opponent}. Nobody cares for Cochise.",
    "I once walked in your camp freely, {opponent}. Then you broke faith.",
  ],
  Tecumseh: [
    "A single twig breaks easily, {opponent}, but a bundle does not.",
    "Show respect to all people, but grovel to none, {opponent}.",
    "Live your life so that the fear of death can never enter your heart, {opponent}.",
    "Where today are our people, {opponent}? They have vanished before greed.",
  ],
  Shaka: [
    "Strike an enemy once and for all, {opponent}.",
    "I need no friends, {opponent}. I need warriors.",
    "You are either the bull or the horns, {opponent}.",
    "I reshaped a nation with discipline, {opponent}. I will reshape this game.",
  ],
  Vercingetorix: [
    "I took up arms for the liberty of all, {opponent}.",
    "United, the tribes are invincible, {opponent}. Divided, we fall.",
    "I threw my arms at Caesar's feet, {opponent}. But I never broke.",
    "I would rather die free than live a slave, {opponent}.",
  ],
  Batman: [
    "I believe in justice, {opponent}. Don't make me believe in vengeance.",
    "It's not who we are, but what we do that defines us, {opponent}.",
    "I am vengeance. I am the night, {opponent}.",
    "I have one rule, {opponent}. Don't make me break it.",
  ],
  Toussaint: [
    "I was born a slave, {opponent}, but nature gave me the soul of a free man.",
    "In overthrowing me, you have done no more than cut the trunk, {opponent}.",
    "I fight for the liberty of my people, {opponent}.",
    "Roots are deep, {opponent}. New shoots will spring up.",
  ],
  Wallace: [
    "Every man dies, {opponent}. Not every man really lives.",
    "Freedom, {opponent}! That is what I fight for.",
    "They may take our lives, but they will never take our freedom, {opponent}.",
    "I have bled for this cause, {opponent}. I will not stop now.",
  ],
  Zenobia: [
    "I am a queen who fights, {opponent}. Not one who surrenders.",
    "I marched against Rome, {opponent}. You do not frighten me.",
    "I ruled Palmyra with an iron will, {opponent}.",
    "I would rather fall as a ruler than kneel as a subject, {opponent}.",
  ],
  Maccabeus: [
    "The hammer strikes, {opponent}. That is what my name means.",
    "I fight for what is sacred, {opponent}.",
    "Against all odds, we prevailed, {opponent}.",
    "Tyranny falls to those who refuse to submit, {opponent}.",
  ],
  Scipio: [
    "I defeated Hannibal at Zama, {opponent}. I do not lose.",
    "A general must study his opponent, {opponent}. I have studied you.",
    "I was patient, {opponent}. Patience is how empires are built.",
    "I gave mercy to the defeated, {opponent}. But only once.",
  ],
  Coriolanus: [
    "I would rather serve no one than serve the ungrateful, {opponent}.",
    "Banished? It is I who banish you, {opponent}.",
    "I earned my name in blood, {opponent}. Not in speeches.",
    "The people are fickle, {opponent}. I am not.",
  ],
  Ajax: [
    "Give me my armor and point me at the enemy, {opponent}.",
    "I am the shield of the Greeks, {opponent}.",
    "Strength, not cunning, wins the day, {opponent}.",
    "I will not yield, {opponent}. I am Ajax.",
  ],
};

export const BOT_BETRAYALS: Record<string, string[]> = {
  // ─── ALWAYS COOPERATE ──────────────────────────────────────────────
  Gandhi: [
    "You struck me, but I still stand with open hands, {opponent}.",
    "First they ignore you, then they fight you — then you win, {opponent}.",
  ],
  Teresa: [
    "I will love you still, {opponent}. That is my only weapon.",
  ],
  Rogers: [
    "I'm disappointed, {opponent}, but I still believe in you.",
  ],
  Mandela: [
    "Resentment is like drinking poison, {opponent}. I choose not to drink.",
  ],
  Lincoln: [
    "I am firm in my purpose, {opponent}, but still your friend.",
  ],
  Buddha: [
    "Holding onto anger is like grasping hot coal, {opponent}. I let go.",
  ],

  // ─── ALWAYS DEFECT ─────────────────────────────────────────────────
  Machiavelli: [
    "You thought cooperating would save you, {opponent}? How naive.",
  ],
  Attila: [
    "Your trust was your downfall, {opponent}.",
  ],
  Blackbeard: [
    "Did you expect honor among thieves, {opponent}?",
  ],
  Caligula: [
    "Your suffering amuses me, {opponent}.",
  ],

  // ─── TIT FOR TAT ──────────────────────────────────────────────────
  Hammurabi: [
    "The code demands reciprocity, {opponent}. You defected — so shall I.",
  ],
  Aurelius: [
    "You chose poorly, {opponent}. I will mirror your choice exactly.",
  ],
  Confucius: [
    "You did unto me, {opponent}. Now I do unto you.",
  ],
  Socrates: [
    "You have answered my question, {opponent}. Now hear mine.",
  ],

  // ─── RANDOM ────────────────────────────────────────────────────────
  Joker: [
    "You think betrayal bothers me, {opponent}? I don't even have a plan!",
    "See, {opponent}, nobody panics when things go according to plan.",
  ],
  Diogenes: [
    "So you are dishonest after all, {opponent}. My lantern search continues.",
  ],
  Nietzsche: [
    "What does not kill this game makes it more interesting, {opponent}.",
  ],

  // ─── GRUDGER ───────────────────────────────────────────────────────
  Batman: [
    "You've crossed the line, {opponent}. I won't forget.",
    "I gave you a chance, {opponent}. You won't get another.",
  ],
  Leonidas: [
    "You showed your hand, {opponent}. Now face the 300.",
  ],
  Spartacus: [
    "You chained me once, {opponent}. Never again.",
  ],
  Cato: [
    "Carthago delenda est, {opponent}. And so are you.",
  ],
  Joan: [
    "God sees your treachery, {opponent}. And so do I.",
  ],
  Wallace: [
    "You betrayed my trust, {opponent}. That was your last mistake.",
  ],
  Scipio: [
    "I gave you mercy once, {opponent}. I do not repeat gifts.",
  ],
};
