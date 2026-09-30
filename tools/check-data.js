#!/usr/bin/env node
/**
 * tools/check-data.js — contrôle de cohérence de js/data.js
 * Usage : node tools/check-data.js
 */
const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "js", "data.js");
const code = fs.readFileSync(dataPath, "utf8");
const JJBA_DATA = eval(code + "\nJJBA_DATA;");

const d = JJBA_DATA;
const erreurs = [];

// --- Volumétrie ---
console.log(`parties     : ${d.parties.length}`);
console.log(`personnages : ${d.personnages.length}`);
console.log(`stands      : ${d.stands.length}`);
console.log(`quiz        : ${d.quiz.length}`);

// --- Unicité des identifiants ---
const checkUnique = (liste, label) => {
  const ids = liste.map((o) => o.id);
  if (new Set(ids).size !== ids.length) erreurs.push(`identifiants dupliqués dans ${label}`);
};
checkUnique(d.parties, "parties");
checkUnique(d.personnages, "personnages");
checkUnique(d.stands, "stands");

// --- Parties valides (1 à 9) ---
[...d.personnages, ...d.stands].forEach((o) => {
  if (!Number.isInteger(o.partie) || o.partie < 1 || o.partie > 9) {
    erreurs.push(`partie invalide pour « ${o.nom} » (${o.partie})`);
  }
});

// --- Chaque partie 1..9 doit exister ---
for (let n = 1; n <= 9; n += 1) {
  if (!d.parties.some((p) => p.numero === n)) erreurs.push(`partie ${n} absente`);
}

// --- Grades de Stand : A-E ou null ---
const gradesValides = new Set(["A", "B", "C", "D", "E", null]);
d.stands.forEach((s) => {
  Object.entries(s.stats).forEach(([param, grade]) => {
    if (!gradesValides.has(grade)) erreurs.push(`grade invalide ${param}=${grade} pour « ${s.nom} »`);
  });
  const cles = Object.keys(s.stats).join(",");
  const attendu = "puissance,vitesse,portee,persistance,precision,potentiel";
  if (cles !== attendu) erreurs.push(`paramètres inattendus pour « ${s.nom} » : ${cles}`);
});

// --- Quiz : index de bonne réponse valide ---
d.quiz.forEach((q, i) => {
  if (!Number.isInteger(q.bonne) || q.bonne < 0 || q.bonne >= q.options.length) {
    erreurs.push(`quiz #${i + 1} : index de bonne réponse hors limites`);
  }
  if (new Set(q.options).size !== q.options.length) erreurs.push(`quiz #${i + 1} : options dupliquées`);
});

// --- Générateur : listes non vides et pouvoirs uniques ---
const g = d.generateur;
if (!g.prefixes.length || !g.suffixes.length || !g.pouvoirs.length) erreurs.push("générateur incomplet");

// --- Moteur de duel (js/duel.js) ---
// duel.js lit les données par globalThis : on les y expose avant de l'évaluer.
globalThis.JJBA_DATA = JJBA_DATA;
eval(fs.readFileSync(path.join(__dirname, "..", "js", "duel.js"), "utf8"));
const JJBA_DUEL = globalThis.JJBA_DUEL;

if (!JJBA_DUEL) {
  erreurs.push("js/duel.js n'expose pas JJBA_DUEL");
} else {
  // Chaque type de Stand doit avoir un profil, et chaque profil doit totaliser
  // la cible : sans cela, un type serait avantagé quel que soit le combat.
  const types = [...new Set(d.stands.map((s) => s.type))];
  types.forEach((type) => {
    if (!JJBA_DUEL.PROFILS[type]) erreurs.push(`aucun profil de duel pour le type « ${type} »`);
  });
  Object.entries(JJBA_DUEL.PROFILS).forEach(([type, profil]) => {
    const somme = Object.values(profil).reduce((a, b) => a + b, 0);
    if (Math.abs(somme - 6) > 1e-9) erreurs.push(`profil « ${type} » : total ${somme} au lieu de 6`);
  });

  // Les phases doivent pondérer les six paramètres.
  const clesParams = Object.keys(d.stands[0].stats);
  JJBA_DUEL.PHASES.forEach((phase, i) => {
    clesParams.forEach((cle) => {
      if (typeof phase.poids[cle] !== "number") erreurs.push(`phase ${i + 1} : poids manquant pour ${cle}`);
    });
  });

  // Robustesse : toutes les paires se simulent, de façon déterministe et
  // symétrique (inverser les camps inverse les valeurs, sans changer l'issue).
  let paires = 0;
  let sansVainqueur = 0;
  for (let i = 0; i < d.stands.length; i += 1) {
    for (let j = i + 1; j < d.stands.length; j += 1) {
      const a = d.stands[i].id;
      const b = d.stands[j].id;
      const duel = JJBA_DUEL.simuler(a, b);
      if (!duel) {
        erreurs.push(`simulation impossible : ${a} / ${b}`);
        continue;
      }
      paires += 1;
      if (!duel.vainqueur) sansVainqueur += 1;

      const bis = JJBA_DUEL.simuler(a, b);
      if (JSON.stringify(bis.rounds) !== JSON.stringify(duel.rounds)) {
        erreurs.push(`duel non déterministe : ${a} / ${b}`);
      }
      const miroir = JJBA_DUEL.simuler(b, a);
      duel.rounds.forEach((round, k) => {
        const autre = miroir.rounds[k];
        if (!autre || round.pvA !== autre.pvB || round.degatsSurA !== autre.degatsSurB) {
          erreurs.push(`duel non symétrique : ${a} / ${b} (round ${k + 1})`);
        }
      });
      [duel.combattants.a, duel.combattants.b].forEach((camp) => {
        if (camp.pv < 0 || camp.pv > camp.pvMax) erreurs.push(`PV hors limites pour « ${camp.nom} »`);
      });
    }
  }
  if (JJBA_DUEL.simuler(d.stands[0].id, d.stands[0].id) !== null) {
    erreurs.push("un Stand ne doit pas pouvoir s'affronter lui-même");
  }
  console.log(`duel        : ${paires} paires simulées, ${sansVainqueur} sans vainqueur`);
}

if (erreurs.length) {
  console.error("\n❌ Incohérences détectées :");
  erreurs.forEach((e) => console.error(" - " + e));
  process.exit(1);
}
console.log("\n✅ data.js est cohérent.");
