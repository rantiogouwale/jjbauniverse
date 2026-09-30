/* =========================================================================
   smoke.js — test de fumée (développement uniquement, pas chargé en production)

   Utilisation :
     1. dans index.html, juste après <script src="js/app.js"></script>, ajouter :
        <script src="tools/smoke.js"></script>
     2. ouvrir la page via un serveur local (python3 -m http.server) puis lire
        <pre id="smoke"> en bas de page (ou document.title, préfixe « SMOKE: »).
     3. penser à retirer la balise <script> après le test.

   Alternative en ligne de commande (navigateur Chromium) :
     chrome --headless=new --virtual-time-budget=15000 --dump-dom http://localhost:8000/
   ========================================================================= */
(function () {
  "use strict";

  const resultats = [];
  const verifier = (nom, condition, detail) => {
    resultats.push({ nom: nom, ok: !!condition, detail: detail === undefined ? "" : detail });
  };

  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);

  async function allerA(vue) {
    window.location.hash = "#/" + vue;
    await attendre(60);
  }

  async function executer() {
    await attendre(60);

    // 1. Accueil : statistiques
    const stats = document.querySelectorAll("#statsAccueil .stat");
    verifier("accueil — statistiques rendues", stats.length === 5, stats.length + " blocs");

    // 2. Duel ORA / MUDA
    $("#btnOra").click();
    $("#btnMuda").click();
    $("#btnMuda").click();
    await attendre(20);
    verifier("accueil — duel ORA/MUDA",
      $("#scoreOra").textContent === "1" && $("#scoreMuda").textContent === "2",
      $("#scoreOra").textContent + " / " + $("#scoreMuda").textContent);

    // 3. Thème Hamon ↔ Stand
    const themeAvant = document.documentElement.dataset.theme;
    $("#themeToggle").click();
    await attendre(20);
    verifier("thème — bascule", document.documentElement.dataset.theme !== themeAvant,
      themeAvant + " → " + document.documentElement.dataset.theme);

    // 3bis. Navigation mobile (burger)
    $("#burger").click();
    await attendre(20);
    verifier("burger — ouverture du menu", $("#nav").classList.contains("is-open"));
    $("#burger").click();
    await attendre(20);
    verifier("burger — fermeture du menu", !$("#nav").classList.contains("is-open"));

    // 3ter. Raccourcis « Par où commencer ? »
    document.querySelector(".starter").click();
    await attendre(60);
    verifier("accueil — raccourci redirige", window.location.hash === "#/parties",
      window.location.hash);

    // 4. Timeline + fiche de partie
    await allerA("parties");
    const cartes = document.querySelectorAll("#timeline .tl-card");
    verifier("parties — 9 cartes", cartes.length === 9, cartes.length + " cartes");
    cartes[0].click();
    await attendre(40);
    verifier("parties — modale ouverte",
      !$("#modal").hidden && /Résumé/.test($("#modalBody").textContent));
    const chipsPartie = $("#modalBody").querySelectorAll(".modal__tags .chip");
    verifier("parties — personnages listés", chipsPartie.length > 0, chipsPartie.length + " chips");
    $("#modal").querySelector(".modal__close").click();
    await attendre(30);
    verifier("modale — fermeture au clic", $("#modal").hidden === true);

    // 5. Personnages : recherche puis filtre
    await allerA("personnages");
    const grille = $("#grillePersonnages");
    verifier("personnages — 42 cartes", grille.children.length === 42, grille.children.length + " cartes");

    const champ = $("#recherchePerso");
    champ.value = "jotaro";
    champ.dispatchEvent(new Event("input"));
    await attendre(200);
    verifier("personnages — recherche « jotaro »",
      grille.children.length > 0 && grille.children.length < 42, grille.children.length + " cartes");

    champ.value = "zzzzzz";
    champ.dispatchEvent(new Event("input"));
    await attendre(200);
    verifier("personnages — état vide", $("#videPerso").hidden === false && grille.children.length === 0);

    champ.value = "";
    champ.dispatchEvent(new Event("input"));
    await attendre(200);
    const chipP3 = Array.from($("#chipsParties").querySelectorAll(".chip")).find((c) => c.textContent === "P3");
    chipP3.click();
    await attendre(60);
    verifier("personnages — filtre partie 3",
      grille.children.length > 0 && grille.children.length < 42, grille.children.length + " cartes en P3");
    chipP3.click();
    await attendre(30);
    verifier("personnages — clic répété sans erreur", grille.children.length > 0);

    // 6. Fiche personnage
    grille.children[0].click();
    await attendre(40);
    verifier("personnages — fiche ouverte",
      !$("#modal").hidden && $("#modalBody").textContent.length > 50);
    $("#modal").querySelector(".modal__close").click();
    await attendre(30);

    // 7. Stands : filtres, grades, fiche
    await allerA("stands");
    const grilleS = $("#grilleStands");
    verifier("stands — 36 cartes", grilleS.children.length === 36, grilleS.children.length + " cartes");
    verifier("stands — 6 paramètres par carte", grilleS.querySelector(".params").children.length === 6);
    verifier("stands — grades A→E", /^[A-E—]$/.test(grilleS.querySelector(".param__grade").textContent),
      grilleS.querySelector(".param__grade").textContent);

    const chipType = Array.from($("#chipsTypes").querySelectorAll(".chip"))
      .find((c) => c.textContent !== "Tous les types");
    chipType.click();
    await attendre(60);
    verifier("stands — filtre par type",
      grilleS.children.length > 0 && grilleS.children.length < 36,
      chipType.textContent + " → " + grilleS.children.length);

    Array.from($("#chipsTypes").querySelectorAll(".chip"))
      .find((c) => c.textContent === "Tous les types").click();
    await attendre(60);

    const champS = $("#rechercheStand");
    champS.value = "star platinum";
    champS.dispatchEvent(new Event("input"));
    await attendre(200);
    verifier("stands — recherche « star platinum »",
      grilleS.children.length >= 1 && grilleS.children.length < 36, grilleS.children.length + " résultat(s)");
    champS.value = "";
    champS.dispatchEvent(new Event("input"));
    await attendre(200);

    await allerA("stands");
    grilleS.children[0].click();
    await attendre(40);
    verifier("stands — fiche ouverte", !$("#modal").hidden && /six paramètres/i.test($("#modalBody").textContent));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await attendre(30);
    verifier("modale — fermeture via Échap", $("#modal").hidden === true);

    // 8. Quiz : parcours complet
    await allerA("quiz");
    verifier("quiz — 4 options", document.querySelectorAll("#quizShell .option").length === 4);
    let questions = 0;
    while (questions < 12) {
      const options = document.querySelectorAll("#quizShell .option");
      if (!options.length) break;
      questions += 1;
      options[0].click();
      await attendre(40);
      const suite = Array.from($("#quizShell").querySelectorAll("button"))
        .find((b) => /Question suivante|Voir mon résultat/.test(b.textContent));
      if (!suite) break;
      suite.click();
      await attendre(40);
    }
    verifier("quiz — 10 questions parcourues", questions === 10, questions + " questions");
    verifier("quiz — écran de résultat", !!$("#quizShell .quiz__score"),
      $("#quizShell .quiz__score") ? $("#quizShell .quiz__score").textContent : "absent");
    verifier("quiz — verdict affiché", !!$("#quizShell .quiz__verdict"));
    verifier("quiz — meilleur score persisté", /Meilleur score : \d+\/10/.test($("#quizShell").textContent));

    const rejouer = Array.from($("#quizShell").querySelectorAll("button"))
      .find((b) => b.textContent === "Rejouer");
    rejouer.click();
    await attendre(40);
    verifier("quiz — rejouer repart à la question 1", /Question 1 \/ 10/.test($("#quizShell").textContent));

    // 9. Générateur : déterminisme
    await allerA("generateur");
    $("#genNom").value = "Jolyne";
    $("#genDate").value = "1992-06-21";
    $("#formGenerateur").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await attendre(60);
    const premier = $("#carteStandGenere").textContent;
    verifier("générateur — carte produite", !!$("#carteStandGenere .gen-card"), premier.slice(0, 40) + "…");
    verifier("générateur — six paramètres", $("#carteStandGenere .params").children.length === 6);

    $("#formGenerateur").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await attendre(60);
    verifier("générateur — déterminisme", premier === $("#carteStandGenere").textContent);

    $("#genNom").value = "Anasui";
    $("#formGenerateur").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await attendre(60);
    verifier("générateur — entrée différente → Stand différent",
      premier !== $("#carteStandGenere").textContent);

    $("#formGenerateur").dispatchEvent(new Event("reset", { cancelable: true }));
    await attendre(30);
    verifier("générateur — réinitialisation vide la carte", $("#carteStandGenere").children.length === 0);

    // 10. Stand Duel : affichage, deep link, raccourcis, moteur
    await allerA("duel");
    verifier("duel — vue affichée", $("#view-duel").hidden === false);
    verifier("duel — 36 Stands dans chaque sélecteur",
      $("#duelSelectA").options.length === 36 && $("#duelSelectB").options.length === 36,
      $("#duelSelectA").options.length + " / " + $("#duelSelectB").options.length);
    verifier("duel — duel rendu d'emblée", !!$("#duelTerrain .sd-verdict"),
      ($("#duelTerrain .sd-verdict__title") || {}).textContent);
    verifier("duel — deux cartes de combattant", document.querySelectorAll("#duelTerrain .sd-card").length === 2);
    const roundsAffiches = document.querySelectorAll("#duelTerrain .sd-log li").length;
    verifier("duel — journal des phases", roundsAffiches >= 1 && roundsAffiches <= 5, roundsAffiches + " round(s)");
    verifier("duel — barres de vie présentes", document.querySelectorAll("#duelTerrain .sd-pv__fill").length === 2);

    window.location.hash = "#/duel/star-platinum/the-world";
    await attendre(90);
    verifier("duel — deep link appliqué",
      $("#duelSelectA").value === "star-platinum" && $("#duelSelectB").value === "the-world",
      $("#duelSelectA").value + " vs " + $("#duelSelectB").value);

    const titreDuel = $("#duelTerrain .sd-verdict__title").textContent;
    $("#duelLancer").click();
    await attendre(40);
    verifier("duel — relancer redonne le même verdict",
      $("#duelTerrain .sd-verdict__title").textContent === titreDuel, titreDuel);

    const campAvant = $("#duelSelectA").value;
    $("#duelEchanger").click();
    await attendre(40);
    verifier("duel — échanger inverse les camps",
      $("#duelSelectA").value !== campAvant && $("#duelSelectB").value === campAvant,
      $("#duelSelectA").value + " vs " + $("#duelSelectB").value);

    $("#duelSurprise").click();
    await attendre(40);
    verifier("duel — « surprise-moi » produit un duel", !!$("#duelTerrain .sd-verdict"));

    $("#duelJour").click();
    await attendre(40);
    const paireJour = $("#duelSelectA").value + "/" + $("#duelSelectB").value;
    $("#duelJour").click();
    await attendre(40);
    verifier("duel — « duel du jour » stable dans la journée",
      paireJour === $("#duelSelectA").value + "/" + $("#duelSelectB").value, paireJour);

    // Moteur pur (js/duel.js), sans passer par le DOM
    const moteur = window.JJBA_DUEL;
    const duelDirect = moteur.simuler("star-platinum", "the-world");
    const duelRepete = moteur.simuler("star-platinum", "the-world");
    const miroir = moteur.simuler("the-world", "star-platinum");
    verifier("moteur — déterminisme", JSON.stringify(duelDirect.rounds) === JSON.stringify(duelRepete.rounds));
    verifier("moteur — symétrie des camps",
      duelDirect.rounds.every((r, i) => r.pvA === miroir.rounds[i].pvB && r.degatsSurA === miroir.rounds[i].degatsSurB));
    verifier("moteur — un Stand ne s'affronte pas lui-même",
      moteur.simuler("star-platinum", "star-platinum") === null);
    verifier("moteur — identifiant inconnu ignoré", moteur.simuler("star-platinum", "inexistant") === null);

    let paires = 0;
    let sansVerdict = 0;
    let kos = 0;
    const idsStands = window.JJBA_DATA.stands.map((s) => s.id);
    for (let i = 0; i < idsStands.length; i += 1) {
      for (let j = i + 1; j < idsStands.length; j += 1) {
        const duel = moteur.simuler(idsStands[i], idsStands[j]);
        paires += 1;
        if (!duel) sansVerdict += 1;
        else if (duel.combattants.a.pv === 0 || duel.combattants.b.pv === 0) kos += 1;
      }
    }
    verifier("moteur — 630 duels simulés sans erreur",
      paires === 630 && sansVerdict === 0, paires + " duels, " + kos + " K.O.");

    // 11. Finitions : son, ZA WARUDO, roulette, collection
    const sonToggle = $("#sonToggle");
    const sonAvant = sonToggle.getAttribute("aria-pressed");
    sonToggle.click();
    await attendre(40);
    verifier("son — bascule l'état", sonToggle.getAttribute("aria-pressed") !== sonAvant,
      sonAvant + " → " + sonToggle.getAttribute("aria-pressed"));
    verifier("son — choix mémorisé",
      window.localStorage.getItem("jojopedia:son") === sonToggle.getAttribute("aria-pressed").replace("true", "on").replace("false", "off"),
      String(window.localStorage.getItem("jojopedia:son")));
    sonToggle.click();
    await attendre(30);
    verifier("son — retour au silence", sonToggle.getAttribute("aria-pressed") === sonAvant);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    await attendre(60);
    verifier("ZA WARUDO — le temps s'arrête",
      document.documentElement.classList.contains("is-za-warudo") && $("#zawarudo").hidden === false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    await attendre(60);
    verifier("ZA WARUDO — le temps reprend",
      document.documentElement.classList.contains("is-za-warudo") === false && $("#zawarudo").hidden === true);

    await allerA("stands");
    $("#standAuHasard").click();
    await attendre(1000);
    verifier("roulette — une fiche Stand s'ouvre",
      !$("#modal").hidden && /six paramètres/i.test($("#modalBody").textContent));
    $("#modal").querySelector(".modal__close").click();
    await attendre(40);

    await allerA("stands");
    const vusAvant = document.querySelectorAll("#grilleStands .card.is-vu").length;
    const compteAvant = $("#collectionStands").textContent;
    const carteVierge = document.querySelector("#grilleStands .card:not(.is-vu)");
    verifier("collection — compteur affiché", /Collection : \d+ \/ 36/.test(compteAvant), compteAvant);
    if (carteVierge) {
      carteVierge.click();
      await attendre(60);
      const vusApres = document.querySelectorAll("#grilleStands .card.is-vu").length;
      verifier("collection — fiche marquée comme vue", vusApres === vusAvant + 1, vusAvant + " → " + vusApres);
      verifier("collection — compteur incrémenté", $("#collectionStands").textContent !== compteAvant,
        $("#collectionStands").textContent);
    } else {
      verifier("collection — fiche marquée comme vue", false, "aucune carte vierge à tester");
    }
    const collectionStockee = window.localStorage.getItem("jojopedia:collection");
    verifier("collection — persistée dans le navigateur",
      !!collectionStockee && JSON.parse(collectionStockee).length > 0,
      collectionStockee ? JSON.parse(collectionStockee).length + " fiche(s)" : "absente");

    await allerA("personnages");
    $("#persoAuHasard").click();
    await attendre(1000);
    verifier("roulette — une fiche Personnage s'ouvre",
      !$("#modal").hidden && /Biographie/.test($("#modalBody").textContent),
      ($("#modalTitre") || {}).textContent);
    verifier("collection — compteur des personnages",
      /Collection : \d+ \/ 42/.test($("#collectionPerso").textContent), $("#collectionPerso").textContent);
    $("#modal").querySelector(".modal__close").click();
    await attendre(40);
  }

  executer().then(() => {
    const echecs = resultats.filter((r) => !r.ok);
    const pre = document.createElement("pre");
    pre.id = "smoke";
    pre.textContent = resultats
      .map((r) => (r.ok ? "OK   " : "FAIL ") + r.nom + (r.detail ? " (" + r.detail + ")" : ""))
      .join("\n");
    document.body.appendChild(pre);
    document.title = "SMOKE:" + (echecs.length ? echecs.length + " échec(s)" : "tout est vert");
  });
}());
