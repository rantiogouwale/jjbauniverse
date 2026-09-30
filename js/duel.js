/* =========================================================================
   duel.js — socle déterministe + moteur du « Stand Duel »
   Aucun accès au DOM : ce fichier est utilisable dans le navigateur comme
   dans Node (outils de contrôle), exactement comme js/data.js.

   Principe du simulateur
   ----------------------
   Deux Stands de js/data.js s'affrontent sur cinq phases (de la prise de
   contact au dernier souffle). Les grades A → E deviennent des points,
   pondérés par le type de portée du Stand, puis par la phase en cours :
   un Stand de longue portée domine à distance, un Stand de proche portée
   domine en mêlée.

   Le hasard est *déterministe* : la graine est l'empreinte FNV-1a des deux
   identifiants **triés**, donc #/duel/x/y et #/duel/y/x donnent le même
   combat, avec les camps inversés. Aucun Math.random() ici.

   Utilisation navigateur : window.JJBA_DUEL
   Utilisation Node      : require("./js/duel.js") → globalThis.JJBA_DUEL
   ========================================================================= */
(function () {
  "use strict";

  /* 1. Socle déterministe (partagé avec le générateur de Stand) --------- */

  /** Empreinte FNV-1a sur 32 bits : même texte → même graine. */
  function empreinte(txt) {
    let h1 = 2166136261;
    for (let i = 0; i < txt.length; i += 1) {
      h1 ^= txt.charCodeAt(i);
      h1 = Math.imul(h1, 16777619);
    }
    return h1 >>> 0;
  }

  /** Suite pseudo-aléatoire mulberry32 : reproductible à partir d'une graine. */
  function genererSuite(graine) {
    let a = graine >>> 0;
    return function tirage() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const choisir = (liste, rng) => liste[Math.floor(rng() * liste.length) % liste.length];

  /* 2. Barème ----------------------------------------------------------- */

  /** Clés et libellés des six paramètres — même ordre que PARAMS de app.js. */
  const PARAMS = [
    ["puissance", "Puissance"],
    ["vitesse", "Vitesse"],
    ["portee", "Portée"],
    ["persistance", "Persistance"],
    ["precision", "Précision"],
    ["potentiel", "Potentiel"],
  ];

  /** Grade → points de duel (A = 5 … E = 1). */
  const POINTS = { A: 5, B: 4, C: 3, D: 2, E: 1 };

  /**
   * Les trois fiches « hors échelle » de data.js (Gold Experience Requiem,
   * Made in Heaven, Wonder of U) n'ont aucun grade : elles partent d'une base
   * C et reçoivent un bonus narratif, faute de quoi elles seraient absurdes.
   */
  const POINTS_MANQUANT = 3;
  const BONUS_HORS_ECHELLE = 1.9;

  /** Poids bruts par type de portée (normalisés ensuite pour totaliser 6). */
  const PROFILS_BRUTS = {
    "Proche portée":      { puissance: 1.5,  vitesse: 1.25, portee: 0.6, persistance: 1.0, precision: 0.9,  potentiel: 0.8 },
    "Moyenne portée":     { puissance: 1.0,  vitesse: 1.0,  portee: 1.1, persistance: 1.0, precision: 1.25, potentiel: 0.9 },
    "Longue portée":      { puissance: 0.7,  vitesse: 0.95, portee: 1.6, persistance: 0.9, precision: 1.3,  potentiel: 1.0 },
    "Évolution / ultime": { puissance: 1.0,  vitesse: 1.0,  portee: 1.0, persistance: 1.1, precision: 1.0,  potentiel: 1.6 },
  };

  /** Total visé par chaque profil : rend les types comparables entre eux. */
  const CIBLE_PROFIL = 6;

  const PROFILS = (function () {
    const sortie = {};
    Object.keys(PROFILS_BRUTS).forEach(function (type) {
      const brut = PROFILS_BRUTS[type];
      const somme = PARAMS.reduce(function (total, paire) { return total + brut[paire[0]]; }, 0);
      const profil = {};
      PARAMS.forEach(function (paire) {
        profil[paire[0]] = (brut[paire[0]] * CIBLE_PROFIL) / somme;
      });
      sortie[type] = profil;
    });
    return sortie;
  }());

  /** Les cinq phases du combat : la distance s'ouvre, la mêlée tranche. */
  const PHASES = [
    { nom: "Prise de contact", poids: { portee: 2.0, vitesse: 1.2, precision: 1.0, puissance: 0.6, persistance: 0.6, potentiel: 0.4 } },
    { nom: "Escarmouche",      poids: { portee: 1.4, precision: 1.4, vitesse: 1.2, puissance: 0.9, persistance: 0.7, potentiel: 0.4 } },
    { nom: "Corps à corps",    poids: { puissance: 1.8, vitesse: 1.4, persistance: 1.0, precision: 0.8, portee: 0.4, potentiel: 0.6 } },
    { nom: "Assaut total",     poids: { puissance: 1.7, vitesse: 1.3, precision: 1.0, persistance: 1.1, portee: 0.5, potentiel: 0.7 } },
    { nom: "Dernier souffle",  poids: { potentiel: 1.8, puissance: 1.4, persistance: 1.3, vitesse: 1.0, precision: 0.7, portee: 0.4 } },
  ];

  /** Calibrage : PV = 60 + 10 × persistance, dégâts = base × ratio amplifié. */
  const PV_BASE = 60;
  const PV_PAR_PERSISTANCE = 10;
  const DEGATS_BASE = 30;
  const EXPOSANT_RATIO = 2;
  const MOMENTUM_GAIN = 0.12;
  const MOMENTUM_MAX = 1.5;
  const ALEA_MIN = 0.85;
  const ALEA_AMPLITUDE = 0.3;

  /* 3. Accès aux données ------------------------------------------------ */

  function donnees() {
    if (typeof window !== "undefined" && window.JJBA_DATA) return window.JJBA_DATA;
    if (typeof globalThis !== "undefined" && globalThis.JJBA_DATA) return globalThis.JJBA_DATA;
    return null;
  }

  const standParId = function (id) {
    const d = donnees();
    return d ? d.stands.find(function (s) { return s.id === id; }) || null : null;
  };

  const horsEchelle = (grades) => !grades.puissance;
  const pointsDe = (grades, cle) => POINTS[grades[cle]] || POINTS_MANQUANT;
  const profilDe = (type) => PROFILS[type] || PROFILS["Moyenne portée"];

  /** Score d'un combattant sur une phase (profil × phase × points, bonus). */
  function scorePhase(combattant, phase) {
    const profil = profilDe(combattant.type);
    const brut = PARAMS.reduce(function (total, paire) {
      const cle = paire[0];
      return total + profil[cle] * phase.poids[cle] * pointsDe(combattant.grades, cle);
    }, 0);
    return combattant.horsEchelle ? brut * BONUS_HORS_ECHELLE : brut;
  }

  /* 4. Moteur ----------------------------------------------------------- */

  function combattant(stand) {
    return {
      id: stand.id,
      nom: stand.nom,
      utilisateur: stand.utilisateur,
      type: stand.type,
      partie: stand.partie,
      cri: stand.cri,
      grades: stand.stats,
      horsEchelle: horsEchelle(stand.stats),
      pvMax: PV_BASE + PV_PAR_PERSISTANCE * pointsDe(stand.stats, "persistance"),
      pv: 0,
      momentum: 1,
    };
  }

  /**
   * Simule un duel complet.
   * @returns {object|null} null si un identifiant est inconnu ou identique.
   */
  function simuler(idA, idB) {
    const standA = standParId(idA);
    const standB = standParId(idB);
    if (!standA || !standB || standA.id === standB.id) return null;

    const graine = empreinte([standA.id, standB.id].sort().join("|"));
    const rng = genererSuite(graine);

    const camps = { a: combattant(standA), b: combattant(standB) };
    camps.a.pv = camps.a.pvMax;
    camps.b.pv = camps.b.pvMax;

    const rounds = [];
    let termine = null;

    PHASES.forEach(function (phase, index) {
      if (termine) return;
      const alea = ALEA_MIN + ALEA_AMPLITUDE * rng();
      const scoreA = scorePhase(camps.a, phase) * camps.a.momentum;
      const scoreB = scorePhase(camps.b, phase) * camps.b.momentum;
      const ratio = Math.pow(scoreA, EXPOSANT_RATIO)
        / (Math.pow(scoreA, EXPOSANT_RATIO) + Math.pow(scoreB, EXPOSANT_RATIO));

      const degatsSurB = Math.round(DEGATS_BASE * ratio * alea);
      const degatsSurA = Math.round(DEGATS_BASE * (1 - ratio) * alea);
      const pvAvantA = camps.a.pv;
      const pvAvantB = camps.b.pv;

      camps.a.pv = Math.max(0, camps.a.pv - degatsSurA);
      camps.b.pv = Math.max(0, camps.b.pv - degatsSurB);

      const gagnantRound = degatsSurB === degatsSurA ? null : degatsSurB > degatsSurA ? "a" : "b";
      if (gagnantRound) {
        camps[gagnantRound].momentum = Math.min(MOMENTUM_MAX, camps[gagnantRound].momentum + MOMENTUM_GAIN);
      }

      rounds.push({
        n: index + 1,
        phase: phase.nom,
        degatsSurA: degatsSurA,
        degatsSurB: degatsSurB,
        pvA: camps.a.pv,
        pvB: camps.b.pv,
        gagnant: gagnantRound,
      });

      if (camps.a.pv === 0 || camps.b.pv === 0) {
        if (camps.a.pv === 0 && camps.b.pv === 0) {
          // Les deux tombent : celui qui restait le plus solide se relève.
          termine = pvAvantA === pvAvantB
            ? { vainqueur: null, methode: "double K.O. au round " + (index + 1) }
            : { vainqueur: pvAvantA > pvAvantB ? "a" : "b", methode: "K.O. au round " + (index + 1) + " (double chute)" };
        } else {
          termine = {
            vainqueur: camps.a.pv === 0 ? "b" : "a",
            methode: "K.O. au round " + (index + 1),
          };
        }
      }
    });

    if (!termine) {
      const ecart = camps.a.pv - camps.b.pv;
      termine = {
        vainqueur: ecart === 0 ? null : ecart > 0 ? "a" : "b",
        methode: ecart === 0 ? "égalité parfaite aux points" : "aux points (PV restants)",
      };
    }

    return {
      graine: graine,
      idA: standA.id,
      idB: standB.id,
      combattants: camps,
      rounds: rounds,
      vainqueur: termine.vainqueur,
      methode: termine.methode,
      facteur: facteurDecisif(camps.a, camps.b, termine.vainqueur),
    };
  }

  /**
   * Paramètre qui a le plus pesé : le plus grand écart de score entre les deux
   * camps. Sert à expliquer le verdict plutôt qu'à le justifier après coup.
   */
  function facteurDecisif(a, b, vainqueur) {
    const profilA = profilDe(a.type);
    const profilB = profilDe(b.type);
    const ecarts = PARAMS.map(function (paire) {
      const cle = paire[0];
      const pondereA = profilA[cle] * pointsDe(a.grades, cle);
      const pondereB = profilB[cle] * pointsDe(b.grades, cle);
      return {
        cle: cle,
        label: paire[1],
        ecart: Math.abs(pondereA - pondereB),
        cote: pondereA >= pondereB ? "a" : "b",
        gradeFort: (pondereA >= pondereB ? a : b).grades[cle] || "—",
        gradeFaible: (pondereA >= pondereB ? b : a).grades[cle] || "—",
      };
    });
    ecarts.sort(function (x, y) { return y.ecart - x.ecart; });
    const premier = ecarts[0];
    // Si le vainqueur n'est pas le camp qui domine ce paramètre, on retient
    // le premier paramètre où il est devant : l'explication reste cohérente.
    if (vainqueur && premier.cote !== vainqueur) {
      const sien = ecarts.find(function (e) { return e.cote === vainqueur; });
      if (sien) return sien;
    }
    return premier;
  }

  /* 5. Exposition ------------------------------------------------------- */

  const JJBA_DUEL = {
    PARAMS: PARAMS,
    POINTS: POINTS,
    POINTS_MANQUANT: POINTS_MANQUANT,
    BONUS_HORS_ECHELLE: BONUS_HORS_ECHELLE,
    PROFILS: PROFILS,
    PHASES: PHASES,
    PV_BASE: PV_BASE,
    PV_PAR_PERSISTANCE: PV_PAR_PERSISTANCE,
    DEGATS_BASE: DEGATS_BASE,
    EXPOSANT_RATIO: EXPOSANT_RATIO,
    MOMENTUM_MAX: MOMENTUM_MAX,
    empreinte: empreinte,
    genererSuite: genererSuite,
    choisir: choisir,
    standParId: standParId,
    pointsDe: pointsDe,
    horsEchelle: horsEchelle,
    scorePhase: scorePhase,
    simuler: simuler,
  };

  if (typeof window !== "undefined") window.JJBA_DUEL = JJBA_DUEL;
  else if (typeof globalThis !== "undefined") globalThis.JJBA_DUEL = JJBA_DUEL;
}());
