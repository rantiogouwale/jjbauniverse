/* =========================================================================
   app.js — logique de l'application (aucune dépendance externe)
   Sommaire :
   1. Utilitaires (DOM, formatage, stockage, aléatoire déterministe)
   2. Routeur par hash + navigation
   3. Accueil (stats, duel ORA/MUDA, décor)
   4. Parties (timeline + fiche détaillée)
   5. Personnages (recherche, filtres, fiches)
   6. Stands (recherche, filtres, paramètres A→E)
   7. Quiz (score, correction, meilleur score)
   8. Générateur de Stand (déterministe)
   8bis. Duel de Stands (simulateur + deep link #/duel/<a>/<b>)
   8ter. Finitions (cris synthétisés, ZA WARUDO, roulette, collection)
   9. Modale, thème, initialisation
   ========================================================================= */
(function () {
  "use strict";

  const D = window.JJBA_DATA || (typeof JJBA_DATA !== "undefined" ? JJBA_DATA : null);
  if (!D) throw new Error("JOJO pédia : js/data.js doit être chargé avant js/app.js");
  // Le socle déterministe (empreinte FNV-1a + suite mulberry32) vit dans
  // js/duel.js : il est partagé entre le générateur de Stand et le duel.
  const DUEL = window.JJBA_DUEL;
  if (!DUEL) throw new Error("JOJO pédia : js/duel.js doit être chargé avant js/app.js");
  const STORAGE_KEY_BEST = "jojopedia:meilleurScore";
  const STORAGE_KEY_THEME = "jojopedia:theme";

  /* 1. Utilitaires ---------------------------------------------------- */

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /** Applique une chaîne de style, en gérant les variables CSS personnalisées. */
  function appliquerStyle(node, style) {
    String(style).split(";").forEach((declaration) => {
      const sep = declaration.indexOf(":");
      if (sep === -1) return;
      const prop = declaration.slice(0, sep).trim();
      const valeur = declaration.slice(sep + 1).trim();
      if (!prop || !valeur) return;
      if (prop.indexOf("--") === 0) node.style.setProperty(prop, valeur);
      else node.style[prop.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = valeur;
    });
  }

  /** Crée un élément : h("div", { class: "x", text: "…" }, [enfant1, enfant2]) */
  function h(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        const value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = String(value);
        else if (key === "html") node.innerHTML = value;
        else if (key === "style") appliquerStyle(node, value);
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, "");
        else node.setAttribute(key, String(value));
      });
    }
    (children || []).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  const frag = (children) => {
    const f = document.createDocumentFragment();
    (children || []).forEach((c) => c && f.appendChild(c));
    return f;
  };

  const partieParNumero = (n) => D.parties.find((p) => p.numero === n);

  const trierParPartie = (a, b) => a.partie - b.partie || a.nom.localeCompare(b.nom, "fr");

  const normaliser = (txt) =>
    String(txt)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const initiales = (nom) => {
    const parts = nom.replace(/[«»"]/g, "").split(/\s+/).filter(Boolean);
    return ((parts[0] || "?").charAt(0) + (parts[1] ? parts[1].charAt(0) : "")).toUpperCase();
  };

  /** Stockage défensif : certains navigateurs bloquent localStorage en file:// */
  const stockage = {
    get(cle) {
      try { return window.localStorage.getItem(cle); } catch (e) { return null; }
    },
    set(cle, valeur) {
      try { window.localStorage.setItem(cle, valeur); } catch (e) { /* silencieux */ }
    },
  };

  // Grades → largeur de barre (%)
  const GRADES = {
    A: { pct: 100, label: "A" },
    B: { pct: 80, label: "B" },
    C: { pct: 60, label: "C" },
    D: { pct: 40, label: "D" },
    E: { pct: 20, label: "E" },
  };

  const PARAMS = [
    ["puissance", "Puissance"],
    ["vitesse", "Vitesse"],
    ["portee", "Portée"],
    ["persistance", "Persistance"],
    ["precision", "Précision"],
    ["potentiel", "Potentiel"],
  ];

  /** Construit la liste des six paramètres d'un Stand. */
  function listeParams(stats) {
    return h(
      "ul",
      { class: "params" },
      PARAMS.map(([cle, label]) => {
        const grade = stats[cle];
        const info = GRADES[grade];
        const classe = info ? "grade--" + grade.toLowerCase() : "grade--none";
        return h("li", { class: "param " + classe, style: "--v:" + (info ? info.pct : 0) + "%" }, [
          h("span", { class: "param__label", text: label }),
          h("span", { class: "param__bar" }, [h("span", { class: "param__fill" })]),
          h("span", { class: "param__grade", text: info ? info.label : "—" }),
        ]);
      })
    );
  }

  /** Carte cliquable et accessible au clavier. */
  function carteCliquable(classe, style, contenu, ouvrir) {
    const carte = h("article", {
      class: classe,
      style: style,
      role: "button",
      tabindex: "0",
      "aria-label": "Ouvrir la fiche",
    }, contenu);
    carte.addEventListener("click", ouvrir);
    carte.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ouvrir();
      }
    });
    return carte;
  }

  // Socle déterministe (implémentation unique dans js/duel.js).
  const empreinte = DUEL.empreinte;
  const genererSuite = DUEL.genererSuite;
  const choisir = DUEL.choisir;

  /* 9. Modale (déclaré tôt, utilisé par toutes les vues) --------------- */

  const modale = {
    panel: null,
    body: null,
    focusPrecedent: null,

    init() {
      this.ouvrable = $("#modal");
      this.panel = $(".modal__panel", this.ouvrable);
      this.body = $("#modalBody");
      $$("[data-close='modal']", this.ouvrable).forEach((n) => n.addEventListener("click", () => this.fermer()));
      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && !this.ouvrable.hidden) this.fermer();
      });
    },

    ouvrir(contenu) {
      this.body.replaceChildren(contenu);
      this.ouvrable.hidden = false;
      document.body.style.overflow = "hidden";
      this.focusPrecedent = document.activeElement;
      const cible = $(".modal__close", this.ouvrable);
      if (cible) cible.focus();
    },

    fermer() {
      this.ouvrable.hidden = true;
      this.body.replaceChildren();
      document.body.style.overflow = "";
      if (this.focusPrecedent && this.focusPrecedent.focus) this.focusPrecedent.focus();
    },
  };

  const modalOuverte = () => !$("#modal").hidden;

  /* 2. Routeur & navigation ------------------------------------------- */

  const VUES = ["accueil", "parties", "personnages", "stands", "duel", "quiz", "generateur"];
  const TITRES = {
    accueil: "JOJO pédia — Encyclopédie interactive JoJo's Bizarre Adventure",
    parties: "Les 9 parties — JOJO pédia",
    personnages: "Personnages — JOJO pédia",
    stands: "Stands — JOJO pédia",
    duel: "Stand Duel — JOJO pédia",
    quiz: "Quiz ZA WARUDO — JOJO pédia",
    generateur: "Générateur de Stand — JOJO pédia",
  };

  function vueDepuisHash() {
    const trouve = window.location.hash.match(/^#\/([a-z]+)/i);
    const vue = trouve ? trouve[1].toLowerCase() : "accueil";
    return VUES.indexOf(vue) !== -1 ? vue : "accueil";
  }

  function fermerNav() {
    const nav = $("#nav");
    if (nav) nav.classList.remove("is-open");
    const burger = $("#burger");
    if (burger) burger.setAttribute("aria-expanded", "false");
  }

  function afficher(vue, options) {
    const opts = options || {};
    VUES.forEach((v) => {
      const section = $("#view-" + v);
      if (section) section.hidden = v !== vue;
    });
    $$("#nav a").forEach((lien) => {
      lien.setAttribute("aria-current", lien.dataset.view === vue ? "page" : "false");
    });
    document.title = TITRES[vue] || TITRES.accueil;

    if (vue === "accueil") rendreAccueil();
    if (vue === "parties") rendreTimeline();
    if (vue === "personnages") rendrePersonnages();
    if (vue === "stands") rendreStands();
    if (vue === "duel") rendreDuel();
    if (vue === "quiz") rendreQuiz();
    if (vue === "generateur") rendreGenerateur();

    fermerNav();
    if (!opts.sansScroll) window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* 9bis. Thème & décor ------------------------------------------------ */

  function appliquerTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const bouton = $("#themeToggle");
    // Le libellé est dans un span : l'icône seule suffit sur mobile.
    bouton.replaceChildren(
      frag([
        h("span", { class: "btn__icone", "aria-hidden": "true", text: theme === "stand" ? "☀️" : "🌙" }),
        h("span", { class: "btn__label", text: theme === "stand" ? "Mode Hamon" : "Mode Stand" }),
      ])
    );
    bouton.setAttribute("aria-pressed", String(theme === "hamon"));
    bouton.setAttribute("aria-label", theme === "stand" ? "Passer en mode Hamon" : "Repasser en mode Stand");
    stockage.set(STORAGE_KEY_THEME, theme);
  }

  function initialiserDecor() {
    const zone = $("#decorMenacing");
    const positions = [
      [8, 12], [22, 70], [38, 24], [55, 82], [70, 8], [82, 46],
      [14, 88], [46, 52], [64, 33], [90, 68], [30, 6], [76, 90],
    ];
    positions.forEach(([top, left]) => {
      zone.appendChild(h("span", { text: "ゴ", style: `top:${top}%;left:${left}%` }));
    });
  }

  /* 3. Accueil --------------------------------------------------------- */

  function rendreAccueil() {
    const zone = $("#statsAccueil");
    if (zone.childElementCount) return; // rendu une seule fois

    const stats = [
      [String(D.meta.partiesPubliees), "parties" ],
      [String(D.personnages.length), "personnages"],
      [String(D.stands.length), "stands"],
      [String(D.parties[0].publication), "début de publication"],
      [D.meta.studioAnime, "studio de l'anime"],
    ];
    zone.appendChild(
      frag(
        stats.map(([valeur, label]) =>
          h("div", { class: "stat" }, [
            h("div", { class: "stat__value", text: valeur }),
            h("div", { class: "stat__label", text: label }),
          ])
        )
      )
    );
  }

  /* Duel ORA / MUDA ---------------------------------------------------- */

  const duel = { ora: 0, muda: 0 };

  function lancerCri(camp) {
    const arena = $("#duelArena");
    if (!arena) return;
    duel[camp] += 1;
    $("#scoreOra").textContent = String(duel.ora);
    $("#scoreMuda").textContent = String(duel.muda);

    const texte = camp === "ora" ? "ORA ORA ORA !" : "MUDA MUDA MUDA !";
    const cri = h("span", {
      class: camp === "ora" ? "is-ora" : "is-muda",
      text: texte,
      style: `top:${6 + Math.random() * 70}%;left:${4 + Math.random() * 62}%`,
    });
    arena.appendChild(cri);
    // On garde l'arène lisible : maximum 30 cris affichés.
    while (arena.childElementCount > 30) arena.removeChild(arena.firstElementChild);
    window.setTimeout(() => cri.remove(), 2600);
  }

  /* 4. Parties --------------------------------------------------------- */

  function rendreTimeline() {
    const zone = $("#timeline");
    if (zone.childElementCount) return;

    zone.appendChild(
      frag(
        D.parties.map((partie) => {
          const carte = carteCliquable(
            "tl-card",
            "--c:" + partie.couleur,
            [
              h("div", { class: "tl-card__top" }, [
                h("span", { class: "tl-card__num", text: "Partie " + partie.numero }),
                h("h3", { text: partie.titre }),
                h("span", { class: "tl-card__jp", text: partie.titreJp }),
              ]),
              h("p", { class: "tl-card__accroche", text: partie.accroche }),
              h("div", { class: "tl-card__meta" }, [
                h("span", { text: "📅 " + partie.epoque }),
                h("span", { text: "📍 " + partie.lieu }),
                h("span", { text: "🎯 " + partie.jojo }),
                h("span", { text: "😈 " + partie.antagoniste }),
                h("span", { text: "⚡ " + partie.pouvoir }),
              ]),
            ],
            () => ouvrirPartie(partie)
          );
          carte.setAttribute("aria-label", "Ouvrir la fiche de la partie " + partie.numero + " : " + partie.titre);
          return h("div", { class: "tl-item", style: "--c:" + partie.couleur }, [
            h("span", { class: "tl-item__dot", "aria-hidden": "true" }),
            carte,
          ]);
        })
      )
    );
  }

  function champ(label, valeur) {
    if (!valeur) return null;
    return h("div", { class: "modal__field" }, [
      h("span", { text: label }),
      h("p", { text: valeur }),
    ]);
  }

  function ouvrirPartie(partie) {
    const details = h("div", { class: "modal__grid" }, [
      champ("Publication", "Depuis " + partie.publication + " · " + partie.epoque),
      champ("Lieu", partie.lieu),
      champ("JoJo de la partie", partie.jojo),
      champ("Antagoniste principal", partie.antagoniste),
      champ("Système de pouvoir", partie.pouvoir),
      h("div", { class: "modal__field" }, [
        h("span", { text: "Résumé" }),
        h("p", { text: partie.resume }),
      ]),
      h("div", { class: "modal__field" }, [
        h("span", { text: "Thèmes" }),
        h("div", { class: "modal__tags" }, partie.themes.map((t) => h("span", { text: t }))),
      ]),
      h("div", { class: "modal__field" }, [
        h("span", { text: "Casting principal" }),
        h("div", { class: "modal__tags" }, partie.casting.map((c) => h("span", { text: c }))),
      ]),
      champ("Le saviez-vous ?", partie.note),
      h("div", { class: "modal__field" }, [
        h("span", { text: "Personnages présents sur le site" }),
        h("div", { class: "modal__tags" },
          D.personnages.filter((p) => p.partie === partie.numero).map((p) =>
            h("button", {
              class: "chip",
              type: "button",
              text: p.nom,
              onclick: () => {
                modale.fermer();
                window.location.hash = "#/personnages";
                window.setTimeout(() => ouvrirPersonnage(p), 260);
              },
            })
          )
        ),
      ]),
    ]);

    modale.ouvrir(
      frag([
        h("div", { class: "modal__banner", style: "--c:" + partie.couleur }, [
          h("h2", { id: "modalTitre", text: "Partie " + partie.numero + " — " + partie.titre }),
          h("p", { text: partie.titreJp + " · " + partie.publication }),
        ]),
        details,
      ])
    );
  }

  /* 5. Personnages ----------------------------------------------------- */

  const filtrePerso = { q: "", partie: 0 };

  function rendreChips(zone, actif, options, surClic) {
    zone.replaceChildren(
      frag(
        options.map(({ valeur, label, titre }) =>
          h("button", {
            class: "chip",
            type: "button",
            text: label,
            title: titre || label,
            "aria-pressed": String(valeur === actif),
            onclick: () => surClic(valeur),
          })
        )
      )
    );
  }

  function personnagesFiltres() {
    const q = normaliser(filtrePerso.q.trim());
    return D.personnages
      .filter((p) => (filtrePerso.partie ? p.partie === filtrePerso.partie : true))
      .filter((p) => {
        if (!q) return true;
        const partie = partieParNumero(p.partie);
        const cible = normaliser(
          [p.nom, p.kanji, p.stand, p.role, p.signature, p.bio, p.rejoint, partie ? partie.titre : ""].join(" ")
        );
        return cible.indexOf(q) !== -1;
      })
      .sort(trierParPartie);
  }

  function rendrePersonnages() {
    const options = [{ valeur: 0, label: "Tous", titre: "Toutes les parties" }].concat(
      D.parties.map((p) => ({
        valeur: p.numero,
        label: "P" + p.numero,
        titre: "Partie " + p.numero + " — " + p.titre,
      }))
    );
    rendreChips($("#chipsParties"), filtrePerso.partie, options, (valeur) => {
      filtrePerso.partie = valeur;
      rendrePersonnages();
    });

    const liste = personnagesFiltres();
    const pluriel = liste.length > 1 ? "s" : "";
    $("#comptePerso").textContent =
      liste.length + " personnage" + pluriel + " affiché" + pluriel + " sur " + D.personnages.length +
      (filtrePerso.partie ? " — partie " + filtrePerso.partie : "");
    $("#videPerso").hidden = liste.length !== 0;

    $("#grillePersonnages").replaceChildren(
      frag(
        liste.map((perso) => {
          const carte = carteCliquable(
            "card",
            "--c:" + perso.couleur,
            [
              h("div", { class: "pcard__banner" }, [
                h("span", { class: "pcard__partie", text: "Partie " + perso.partie }),
                h("span", { class: "pcard__initial", "aria-hidden": "true", text: initiales(perso.nom) }),
                h("span", { class: "pcard__kanji", "aria-hidden": "true", text: perso.kanji }),
              ]),
              h("div", { class: "pcard__body" }, [
                h("h3", { text: perso.nom }),
                h("p", { class: "pcard__role", text: perso.role + " · " + perso.rejoint }),
                h("p", { class: "pcard__stand" }, [
                  document.createTextNode("Stand : "),
                  h("b", { text: perso.stand }),
                ]),
                h("p", { class: "pcard__signature", text: perso.signature }),
                perso.replique ? h("p", { class: "pcard__cite", text: "« " + perso.replique + " »" }) : null,
                h("span", { class: "card__more", text: "Fiche complète →" }),
              ]),
            ],
            () => ouvrirPersonnage(perso)
          );
          carte.setAttribute("aria-label", "Ouvrir la fiche de " + perso.nom);
          carte.dataset.id = perso.id;
          if (estVu("perso", perso.id)) carte.classList.add("is-vu");
          return carte;
        })
      )
    );
    majCompteursCollection();
  }

  function ouvrirPersonnage(perso) {
    marquerFicheVue("perso", perso.id);
    const partie = partieParNumero(perso.partie);
    const contenu = h("div", { class: "modal__grid" }, [
      champ("Rôle", perso.role),
      champ("Stand / pouvoir", perso.stand),
      champ("Entrée dans la saga", perso.rejoint),
      h("div", { class: "modal__field" }, [
        h("span", { text: "Signature" }),
        h("p", { text: perso.signature }),
      ]),
      h("div", { class: "modal__field" }, [
        h("span", { text: "Biographie" }),
        h("p", { text: perso.bio }),
      ]),
      perso.replique
        ? h("div", { class: "modal__field" }, [
            h("span", { text: "Réplique culte" }),
            h("p", { class: "modal__quote", text: "« " + perso.replique + " »" }),
          ])
        : null,
      partie
        ? h("div", { class: "modal__field" }, [
            h("span", { text: "Partie d'origine" }),
            h("button", {
              class: "chip",
              type: "button",
              text: "Partie " + partie.numero + " — " + partie.titre,
              onclick: () => {
                modale.fermer();
                window.location.hash = "#/parties";
                window.setTimeout(() => ouvrirPartie(partie), 260);
              },
            }),
          ])
        : null,
    ]);

    modale.ouvrir(
      frag([
        h("div", { class: "modal__banner", style: "--c:" + perso.couleur }, [
          h("h2", { id: "modalTitre", text: perso.nom }),
          h("p", { text: perso.kanji + " · Partie " + perso.partie }),
        ]),
        contenu,
      ])
    );
  }

  /* 6. Stands ---------------------------------------------------------- */

  const filtreStand = { q: "", type: "", partie: 0 };

  function standsFiltres() {
    const q = normaliser(filtreStand.q.trim());
    return D.stands
      .filter((s) => (filtreStand.type ? s.type === filtreStand.type : true))
      .filter((s) => (filtreStand.partie ? s.partie === filtreStand.partie : true))
      .filter((s) => {
        if (!q) return true;
        return normaliser([s.nom, s.utilisateur, s.pouvoir, s.cri, s.ref, s.type].join(" ")).indexOf(q) !== -1;
      })
      .sort(trierParPartie);
  }

  function rendreStands() {
    const types = [];
    D.stands.forEach((s) => {
      if (types.indexOf(s.type) === -1) types.push(s.type);
    });

    rendreChips(
      $("#chipsTypes"),
      filtreStand.type,
      [{ valeur: "", label: "Tous les types", titre: "Tous les types" }].concat(
        types.map((t) => ({ valeur: t, label: t, titre: t }))
      ),
      (valeur) => {
        filtreStand.type = valeur;
        rendreStands();
      }
    );

    rendreChips(
      $("#chipsPartiesStands"),
      filtreStand.partie,
      [{ valeur: 0, label: "Toutes les parties", titre: "Toutes les parties" }].concat(
        D.parties.map((p) => ({
          valeur: p.numero,
          label: "P" + p.numero,
          titre: "Partie " + p.numero + " — " + p.titre,
        }))
      ),
      (valeur) => {
        filtreStand.partie = valeur;
        rendreStands();
      }
    );

    const liste = standsFiltres();
    const pluriel = liste.length > 1 ? "s" : "";
    $("#compteStands").textContent =
      liste.length + " stand" + pluriel + " affiché" + pluriel + " sur " + D.stands.length;
    $("#videStands").hidden = liste.length !== 0;

    $("#grilleStands").replaceChildren(
      frag(
        liste.map((stand) => {
          const partie = partieParNumero(stand.partie);
          const couleur = (partie || {}).couleur || "var(--accent-3)";
          const carte = carteCliquable(
            "card",
            "--c:" + couleur,
            [
              h("div", { class: "scard__head" }, [
                h("h3", { text: stand.nom }),
                h("span", { class: "scard__badge", text: stand.type }),
              ]),
              h("div", { class: "scard__body" }, [
                h("p", { class: "scard__user", text: stand.utilisateur + " · Partie " + stand.partie }),
                h("p", { class: "scard__pouvoir", text: stand.pouvoir }),
                stand.cri !== "—" ? h("div", { class: "scard__cri", text: stand.cri }) : null,
                listeParams(stand.stats),
                h("span", { class: "card__more", text: "Détail du Stand →" }),
              ]),
            ],
            () => ouvrirStand(stand)
          );
          carte.setAttribute("aria-label", "Ouvrir la fiche du Stand " + stand.nom);
          carte.dataset.id = stand.id;
          if (estVu("stand", stand.id)) carte.classList.add("is-vu");
          return carte;
        })
      )
    );
    majCompteursCollection();
  }

  function ouvrirStand(stand) {
    marquerFicheVue("stand", stand.id);
    const partie = partieParNumero(stand.partie);
    const couleur = (partie || {}).couleur || "var(--accent-3)";
    const nonQuantifie = !stand.stats.puissance;

    const contenu = h("div", { class: "modal__grid" }, [
      champ("Utilisateur", stand.utilisateur + " (partie " + stand.partie + ")"),
      champ("Type", stand.type),
      stand.cri !== "—" ? champ("Cri de combat", stand.cri) : null,
      champ("Référence musicale", stand.ref),
      h("div", { class: "modal__field" }, [
        h("span", { text: "Pouvoir" }),
        h("p", { text: stand.pouvoir }),
      ]),
      h("div", { class: "modal__field" }, [
        h("span", { text: "Les six paramètres" }),
        listeParams(stand.stats),
        h("p", {
          class: "legend",
          text: nonQuantifie
            ? "Fiche laissée vide « — » : ce Stand est hors échelle dans le manga."
            : "Grades indicatifs, d'après les fiches officielles (échelle A → E).",
        }),
      ]),
      partie
        ? h("div", { class: "modal__field" }, [
            h("span", { text: "Partie d'origine" }),
            h("button", {
              class: "chip",
              type: "button",
              text: "Partie " + partie.numero + " — " + partie.titre,
              onclick: () => {
                modale.fermer();
                window.location.hash = "#/parties";
                window.setTimeout(() => ouvrirPartie(partie), 260);
              },
            }),
          ])
        : null,
    ]);

    modale.ouvrir(
      frag([
        h("div", { class: "modal__banner", style: "--c:" + couleur }, [
          h("h2", { id: "modalTitre", text: stand.nom }),
          h("p", { text: stand.type + " · " + stand.utilisateur }),
        ]),
        contenu,
      ])
    );
  }

  /* 7. Quiz ------------------------------------------------------------ */

  const quiz = { index: 0, score: 0, repondu: false, termine: false };
  let meilleurScore = parseInt(stockage.get(STORAGE_KEY_BEST), 10);
  if (isNaN(meilleurScore)) meilleurScore = null;

  function libelleMeilleur() {
    const total = D.quiz.length;
    return meilleurScore === null ? "Pas encore de score enregistré" : "Meilleur score : " + meilleurScore + "/" + total;
  }

  function verdict(score) {
    const total = D.quiz.length;
    const ratio = score / total;
    if (ratio === 1) return "ZA WARUDO ! Score parfait, tu es un vrai Stand user.";
    if (ratio >= 0.8) return "Yare yare daze… Très impressionnant.";
    if (ratio >= 0.6) return "Pas mal ! Le Hamon commence à circuler dans tes veines.";
    if (ratio >= 0.4) return "Il te reste quelques épisodes à revoir, mais l'onde est là.";
    return "Muda… Retourne à Morioh t'entraîner, et reviens plus fort.";
  }

  function rendreQuiz() {
    $("#quizShell").replaceChildren(quiz.termine ? ecranResultatQuiz() : ecranQuestionQuiz());
  }

  function ecranQuestionQuiz() {
    const total = D.quiz.length;
    const question = D.quiz[quiz.index];
    const lettres = ["A", "B", "C", "D"];

    const options = question.options.map((texte, i) => {
      const bouton = h("button", {
        class: "option",
        type: "button",
        disabled: quiz.repondu,
        onclick: () => repondreQuiz(i),
      }, [
        h("span", { class: "option__key", text: lettres[i] }),
        h("span", { text: texte }),
      ]);
      if (quiz.repondu) {
        if (i === question.bonne) bouton.classList.add("is-correct");
        else if (i === quiz.derniereReponse) {
          bouton.classList.add("is-wrong");
          bouton.setAttribute("aria-label", "Ma réponse : " + question.options[i]);
        }
      }
      return h("li", null, [bouton]);
    });

    const suite = h("button", {
      class: "btn btn--primary",
      type: "button",
      text: quiz.index === total - 1 ? "Voir mon résultat" : "Question suivante →",
      onclick: () => {
        if (quiz.index === total - 1) {
          quiz.termine = true;
          if (meilleurScore === null || quiz.score > meilleurScore) {
            meilleurScore = quiz.score;
            stockage.set(STORAGE_KEY_BEST, String(meilleurScore));
          }
        } else {
          quiz.index += 1;
          quiz.repondu = false;
        }
        rendreQuiz();
      },
    });

    return frag([
      h("div", { class: "quiz__top" }, [
        h("span", { class: "quiz__progress", text: "Question " + (quiz.index + 1) + " / " + total }),
        h("span", { class: "quiz__best", text: libelleMeilleur() }),
      ]),
      h("div", { class: "quiz__bar" }, [
        h("span", { style: "width:" + Math.round(((quiz.index + (quiz.repondu ? 1 : 0)) / total) * 100) + "%" }),
      ]),
      h("h2", { class: "quiz__question", text: question.question }),
      h("ul", { class: "quiz__options" }, options),
      h("div", { class: "quiz__feedback", hidden: !quiz.repondu }, [
        quiz.repondu && quiz.derniereReponse === question.bonne ? "✅ Bonne réponse ! " : "❌ Raté. ",
        quiz.repondu ? question.explication : "",
      ]),
      quiz.repondu ? suite : null,
    ]);
  }

  function repondreQuiz(choix) {
    if (quiz.repondu) return;
    quiz.repondu = true;
    quiz.derniereReponse = choix;
    if (choix === D.quiz[quiz.index].bonne) quiz.score += 1;
    rendreQuiz();
  }

  function ecranResultatQuiz() {
    const total = D.quiz.length;
    return frag([
      h("div", { class: "quiz__result" }, [
        h("p", { class: "quiz__progress", text: "Résultat final" }),
        h("p", { class: "quiz__score", text: quiz.score + "/" + total }),
        h("p", { class: "quiz__verdict", text: verdict(quiz.score) }),
        h("p", { class: "quiz__best", text: libelleMeilleur() }),
        h("div", { class: "quiz__actions" }, [
          h("button", {
            class: "btn btn--primary",
            type: "button",
            text: "Rejouer",
            onclick: () => {
              quiz.index = 0;
              quiz.score = 0;
              quiz.repondu = false;
              quiz.termine = false;
              rendreQuiz();
            },
          }),
          h("button", {
            class: "btn",
            type: "button",
            text: "Réviser les Stands",
            onclick: () => { window.location.hash = "#/stands"; },
          }),
        ]),
      ]),
    ]);
  }

  /* 8. Générateur de Stand --------------------------------------------- */

  const ARCANES = [
    "L'Étoile", "Le Monde", "La Tour", "Le Chariot", "Le Mat", "Le Magicien",
    "L'Ermite", "L'Impératrice", "L'Empereur", "Le Pape", "La Justice", "Le Pendu",
  ];

  function rendreGenerateur() {
    // Le formulaire du générateur est statique : rien à (re)construire à l'affichage.
  }

  function formaterDate(valeur) {
    const morceaux = String(valeur).split("-");
    if (morceaux.length !== 3) return valeur;
    return morceaux[2] + "/" + morceaux[1] + "/" + morceaux[0];
  }

  /** Même prénom + même date → toujours le même Stand (aucun aléa au rechargement). */
  function genererStandPerso(nom, date) {
    const graine = empreinte(normaliser(nom.trim()) + "|" + date);
    const rng = genererSuite(graine);
    const type = choisir(D.generateur.types, rng);
    const poids = type === "Évolution / ultime"
      ? ["A", "A", "A", "B", "B", "C"]
      : ["A", "B", "B", "C", "C", "D", "E"];

    const stats = {};
    PARAMS.forEach(([cle]) => {
      stats[cle] = choisir(poids, rng);
    });

    return {
      nom: choisir(D.generateur.prefixes, rng) + " " + choisir(D.generateur.suffixes, rng),
      type: type,
      cri: choisir(D.generateur.cris, rng),
      pouvoir: choisir(D.generateur.pouvoirs, rng),
      arcane: choisir(ARCANES, rng),
      partie: 1 + Math.floor(rng() * D.parties.length),
      stats: stats,
      utilisateur: nom.trim(),
      date: date,
    };
  }

  function afficherStandGenere(stand) {
    const partie = partieParNumero(stand.partie);
    const ligne = (label, contenu) =>
      h("div", { class: "gen-card__row" }, [h("span", { text: label }), contenu]);

    const carte = h("article", { class: "gen-card" }, [
      h("div", { class: "gen-card__head" }, [
        h("h3", { text: stand.nom }),
        h("p", { text: "Stand de " + stand.utilisateur + " · né(e) le " + formaterDate(stand.date) }),
      ]),
      h("div", { class: "gen-card__body" }, [
        ligne("Type", h("p", { text: stand.type })),
        ligne("Arcane du Tarot", h("p", { text: stand.arcane })),
        ligne("Cri de combat", h("p", { class: "gen-card__cri", text: stand.cri })),
        ligne("Pouvoir", h("p", { text: stand.pouvoir })),
        ligne("Les six paramètres", listeParams(stand.stats)),
        ligne(
          "Affinité",
          h("p", {
            text: partie
              ? "Compatible avec la partie " + partie.numero + " — " + partie.titre
              : "Affinité inconnue",
          })
        ),
      ]),
    ]);

    carte.style.setProperty("--c", (partie || {}).couleur || "var(--accent)");
    $("#carteStandGenere").replaceChildren(carte);
  }

  function soumettreGenerateur(ev) {
    ev.preventDefault();
    const nom = $("#genNom").value.trim();
    const date = $("#genDate").value;
    if (!nom || !date) return;
    afficherStandGenere(genererStandPerso(nom, date));
  }

  /* 8bis. Duel de Stands ----------------------------------------------- */

  /** Duel affiché par défaut : l'affiche emblématique du manga. */
  const DUEL_DEFAUT = ["star-platinum", "the-world"];
  let duelCourant = null;

  /**
   * Combattants lus dans l'URL (#/duel/<a>/<b>) : le lien est partageable.
   * Toute valeur inconnue est ignorée au profit du duel en cours.
   */
  function campsDepuisHash() {
    const trouve = window.location.hash.match(/^#\/duel\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?/i);
    const valide = (id) => (id && DUEL.standParId(id) ? id : null);
    const a = valide(trouve && trouve[1]);
    const b = valide(trouve && trouve[2]);
    if (a && b) return [a, b];
    if (duelCourant) return [a || duelCourant.idA, b || duelCourant.idB];
    return [a || DUEL_DEFAUT[0], b || DUEL_DEFAUT[1]];
  }

  /** Remplit les deux sélecteurs une seule fois (36 Stands triés par partie). */
  function remplirSelectsDuel() {
    const modeles = D.stands.slice().sort(trierParPartie).map((stand) =>
      h("option", { value: stand.id, text: stand.nom + " — " + stand.utilisateur })
    );
    ["#duelSelectA", "#duelSelectB"].forEach((selecteur) => {
      const noeud = $(selecteur);
      if (!noeud || noeud.childElementCount) return;
      noeud.appendChild(frag(modeles.map((modele) => modele.cloneNode(true))));
    });
  }

  function rendreDuel() {
    remplirSelectsDuel();
    const camps = campsDepuisHash();
    if (duelCourant && duelCourant.idA === camps[0] && duelCourant.idB === camps[1]) {
      // Déjà affiché : on ne rejoue pas l'animation à chaque changement d'URL.
      $("#duelSelectA").value = camps[0];
      $("#duelSelectB").value = camps[1];
      return;
    }
    lancerDuel(camps[0], camps[1], { sansHash: true });
  }

  /** Simule puis affiche un duel. C'est le seul point d'entrée du rendu. */
  function lancerDuel(idA, idB, options) {
    const opts = options || {};
    const duel = DUEL.simuler(idA, idB);
    if (!duel) return;
    duelCourant = duel;

    $("#duelSelectA").value = duel.idA;
    $("#duelSelectB").value = duel.idB;
    if (!opts.sansHash) {
      // replaceState (et non location.hash) : le lien devient partageable sans
      // provoquer de hashchange, donc sans re-rendre la vue.
      try {
        window.history.replaceState(null, "", "#/duel/" + duel.idA + "/" + duel.idB);
      } catch (e) { /* file:// peut refuser : le duel reste consultable */ }
    }

    $("#duelTerrain").replaceChildren(
      frag([
        h("div", { class: "sd-boards" }, [
          carteCombattant(duel, "a"),
          h("div", { class: "sd-vs" }, [
            h("span", { class: "sd-vs__txt", text: "VS" }),
            h("span", {
              class: "sd-vs__phase",
              text: duel.rounds.length + (duel.rounds.length > 1 ? " phases jouées" : " phase jouée"),
            }),
          ]),
          carteCombattant(duel, "b"),
        ]),
        journalDuel(duel),
        verdictDuel(duel),
      ])
    );

    // Cri de victoire, si les cris sont activés (muets par défaut).
    if (duel.vainqueur) jouerCri(duel.vainqueur === "a" ? "ora" : "muda");
  }

  /** Panneau d'un combattant : PV restants, grades, cri. */
  function carteCombattant(duel, cote) {
    const camp = duel.combattants[cote];
    const partie = partieParNumero(camp.partie);
    const couleur = (partie || {}).couleur || "var(--accent-3)";
    const pct = Math.max(0, Math.round((camp.pv / camp.pvMax) * 100));
    const estVainqueur = duel.vainqueur === cote;
    const classes = ["sd-card"];
    if (estVainqueur) classes.push("sd-card--vainqueur");
    if (camp.pv === 0) classes.push("sd-card--ko");

    return h("article", { class: classes.join(" "), style: "--c:" + couleur }, [
      h("div", { class: "sd-card__head" }, [
        h("h3", { text: camp.nom }),
        h("p", { text: camp.utilisateur + " · Partie " + camp.partie }),
      ]),
      h("div", { class: "sd-card__body" }, [
        h("div", { class: "sd-badges" }, [
          h("span", { text: camp.type }),
          camp.horsEchelle ? h("span", { class: "sd-badge--hors", text: "Hors échelle" }) : null,
          estVainqueur ? h("span", { class: "sd-badge--win", text: "Vainqueur" }) : null,
          camp.pv === 0 ? h("span", { text: "K.O." }) : null,
        ]),
        h("div", { class: "sd-pv" }, [
          h("div", { class: "sd-pv__top" }, [
            h("span", { text: "PV" }),
            h("span", { text: camp.pv + " / " + camp.pvMax }),
          ]),
          h(
            "div",
            {
              class: "sd-pv__bar",
              role: "img",
              "aria-label": "Points de vie restants : " + camp.pv + " sur " + camp.pvMax,
            },
            [
              h("span", {
                class: "sd-pv__fill" + (pct <= 35 ? " is-faible" : ""),
                style: "--w:" + pct + "%",
              }),
            ]
          ),
        ]),
        listeParams(camp.grades),
        camp.cri && camp.cri !== "—" ? h("p", { class: "sd-cri", text: camp.cri }) : null,
      ]),
    ]);
  }

  /** Déroulé des phases : une ligne par round, révélée en cascade par le CSS. */
  function journalDuel(duel) {
    return h(
      "ol",
      { class: "sd-log", "aria-label": "Déroulé du combat" },
      duel.rounds.map((round, index) => {
        const classe = round.gagnant === "a" ? "is-a" : round.gagnant === "b" ? "is-b" : "is-nul";
        const avantage = round.gagnant === "a" ? "avantage ORA" : round.gagnant === "b" ? "avantage MUDA" : "round neutre";
        return h("li", { class: classe, style: "--i:" + index }, [
          h("span", { class: "sd-log__n", text: "R" + round.n }),
          h("span", { class: "sd-log__phase", text: round.phase + " · " + avantage }),
          h("span", { class: "sd-log__degats", text: round.pvA + " / " + round.pvB + " PV" }),
        ]);
      })
    );
  }

  /** Bandeau de résultat : vainqueur, méthode, et paramètre décisif. */
  function verdictDuel(duel) {
    const gagnant = duel.vainqueur ? duel.combattants[duel.vainqueur] : null;
    const partie = gagnant ? partieParNumero(gagnant.partie) : null;
    const couleur = (partie || {}).couleur || "var(--accent-3)";
    const grade = (valeur) => (valeur === "—" ? "hors échelle" : valeur);

    // Profils strictement identiques (deux fiches hors échelle, par exemple) :
    // aucune phase ne peut les départager, autant le dire clairement.
    const jumeaux = duel.facteur.ecart === 0;
    const complement = gagnant
      ? "Point décisif : " + duel.facteur.label + " (" + grade(duel.facteur.gradeFort) +
        " contre " + grade(duel.facteur.gradeFaible) + ")"
      : jumeaux
        ? "Profils identiques : aucune phase ne peut les départager — le manga n'a jamais tranché."
        : "Aucun camp n'a réussi à creuser l'écart.";

    return h("div", { class: "sd-verdict", style: "--c:" + couleur }, [
      h("p", {
        class: "sd-verdict__title",
        text: gagnant ? gagnant.nom + " l'emporte !" : jumeaux ? "Duel impossible !" : "Match nul !",
      }),
      h("p", {
        class: "sd-verdict__meta",
        text: (gagnant ? "Victoire " : "") + duel.methode + " · " +
          duel.combattants.a.pv + " / " + duel.combattants.b.pv + " PV",
      }),
      gagnant && gagnant.cri !== "—" ? h("p", { class: "sd-verdict__cri", text: gagnant.cri }) : null,
      h("p", { class: "sd-verdict__why", text: complement }),
    ]);
  }

  /* 8ter. Finitions : cris synthétisés, ZA WARUDO, roulette, collection -- */

  /* --- Cris de combat (Web Audio, aucun fichier audio) ----------------- */

  const STORAGE_KEY_SON = "jojopedia:son";
  const son = { actif: false, ctx: null };

  /** Contexte audio créé à la première utilisation (les navigateurs l'exigent). */
  function contexteAudio() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!son.ctx) {
      try { son.ctx = new Ctor(); } catch (e) { return null; }
    }
    if (son.ctx.state === "suspended") {
      const reprise = son.ctx.resume();
      if (reprise && reprise.catch) reprise.catch(() => { /* blocage navigateur */ });
    }
    return son.ctx;
  }

  /**
   * Synthétise un cri de combat : une rafale d'impulsions, chacune faite d'un
   * bruit filtré (la percussion) et d'un oscillateur (la voix). Tout est généré
   * dans le navigateur : aucun fichier, donc aucun extrait protégé.
   */
  function jouerCri(type) {
    if (!son.actif || document.hidden) return;
    const ctx = contexteAudio();
    if (!ctx) return;

    const aigu = type !== "muda";
    const base = aigu ? 300 : 170;
    const impulsions = aigu ? 5 : 4;
    const duree = 0.07;
    const sortie = ctx.createGain();
    sortie.gain.value = 0.13;
    sortie.connect(ctx.destination);

    for (let i = 0; i < impulsions; i += 1) {
      const debut = ctx.currentTime + i * (duree + 0.015);

      const echantillons = Math.floor(ctx.sampleRate * duree);
      const tampon = ctx.createBuffer(1, echantillons, ctx.sampleRate);
      const donnees = tampon.getChannelData(0);
      for (let k = 0; k < echantillons; k += 1) {
        donnees[k] = (Math.random() * 2 - 1) * (1 - k / echantillons);
      }
      const bruit = ctx.createBufferSource();
      bruit.buffer = tampon;

      const filtre = ctx.createBiquadFilter();
      filtre.type = "bandpass";
      filtre.frequency.value = base * (aigu ? 3.4 : 2.2) * (1 + i * 0.06);
      filtre.Q.value = 1.1;

      const envBruit = ctx.createGain();
      envBruit.gain.setValueAtTime(0.0001, debut);
      envBruit.gain.exponentialRampToValueAtTime(1, debut + 0.012);
      envBruit.gain.exponentialRampToValueAtTime(0.0001, debut + duree);
      bruit.connect(filtre);
      filtre.connect(envBruit);
      envBruit.connect(sortie);
      bruit.start(debut);
      bruit.stop(debut + duree);

      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(base * (aigu ? 1.7 : 1.1) * (1 + i * 0.1), debut);
      osc.frequency.exponentialRampToValueAtTime(base * (aigu ? 0.9 : 0.6), debut + duree * 1.4);
      const envOsc = ctx.createGain();
      envOsc.gain.setValueAtTime(0.0001, debut);
      envOsc.gain.exponentialRampToValueAtTime(0.45, debut + 0.015);
      envOsc.gain.exponentialRampToValueAtTime(0.0001, debut + duree * 1.6);
      osc.connect(envOsc);
      envOsc.connect(sortie);
      osc.start(debut);
      osc.stop(debut + duree * 1.8);
    }
  }

  function appliquerSon(actif, sansRetour) {
    son.actif = actif;
    const bouton = $("#sonToggle");
    if (bouton) {
      bouton.textContent = actif ? "🔊" : "🔇";
      bouton.setAttribute("aria-pressed", String(actif));
      bouton.setAttribute("aria-label", actif ? "Couper les cris de combat" : "Activer les cris de combat");
    }
    stockage.set(STORAGE_KEY_SON, actif ? "on" : "off");
    // Retour sonore immédiat quand on l'active (sauf au chargement : les
    // navigateurs n'autorisent l'audio qu'après une interaction).
    if (actif && !sansRetour) jouerCri("ora");
  }

  /* --- ZA WARUDO (touche T) ------------------------------------------- */

  const ZA_DUREE = 5;
  const zaWarudo = { actif: false, restant: 0, minuteur: null, overlay: null };

  function majCompteurZa() {
    const compteur = $(".zawarudo__count", zaWarudo.overlay);
    if (compteur) compteur.textContent = String(zaWarudo.restant);
  }

  /** Fige la page pendant quelques secondes, puis rend le temps au monde. */
  function arreterLeTemps() {
    if (zaWarudo.actif) {
      reprendreLeTemps();
      return;
    }
    zaWarudo.actif = true;
    zaWarudo.restant = ZA_DUREE;
    zaWarudo.overlay.hidden = false;
    document.documentElement.classList.add("is-za-warudo");
    majCompteurZa();
    jouerCri("muda");
    zaWarudo.minuteur = window.setInterval(() => {
      zaWarudo.restant -= 1;
      if (zaWarudo.restant <= 0) reprendreLeTemps();
      else majCompteurZa();
    }, 1000);
  }

  function reprendreLeTemps() {
    if (zaWarudo.minuteur) window.clearInterval(zaWarudo.minuteur);
    zaWarudo.minuteur = null;
    zaWarudo.actif = false;
    zaWarudo.overlay.hidden = true;
    document.documentElement.classList.remove("is-za-warudo");
  }

  function initialiserZaWarudo() {
    zaWarudo.overlay = h("div", { class: "zawarudo", id: "zawarudo", hidden: true }, [
      h("p", { class: "zawarudo__title", text: "ZA WARUDO !" }),
      h("p", { class: "zawarudo__count", text: String(ZA_DUREE) }),
      h("p", { class: "zawarudo__note", text: "Le temps est arrêté — appuie à nouveau sur T pour reprendre." }),
    ]);
    document.body.appendChild(zaWarudo.overlay);

    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "t" && ev.key !== "T") return;
      const cible = ev.target;
      const balise = cible && cible.tagName;
      // On ne vole pas la frappe dans un champ de saisie ni dans une modale.
      if (balise === "INPUT" || balise === "TEXTAREA" || balise === "SELECT") return;
      if (cible && cible.isContentEditable) return;
      if (!modale.ouvrable.hidden) return;
      arreterLeTemps();
    });
  }

  /* --- Roulette « au hasard » ----------------------------------------- */

  let rouletteEnCours = false;

  /**
   * Fait défiler des noms sur le bouton (effet machine à sous) puis ouvre la
   * fiche tirée au sort. Le hasard ne porte que sur le choix de la fiche.
   */
  function lancerRoulette(liste, bouton, ouvrir) {
    if (rouletteEnCours || !liste.length) return;
    rouletteEnCours = true;
    const libelle = bouton.textContent;
    let tours = 0;
    const minuterie = window.setInterval(() => {
      tours += 1;
      bouton.textContent = "🎲 " + liste[Math.floor(Math.random() * liste.length)].nom;
      if (tours < 8) return;
      window.clearInterval(minuterie);
      bouton.textContent = libelle;
      rouletteEnCours = false;
      ouvrir(liste[Math.floor(Math.random() * liste.length)]);
    }, 80);
  }

  /* --- Collection : fiches déjà consultées ---------------------------- */

  const STORAGE_KEY_COLLECTION = "jojopedia:collection";

  function lireCollection() {
    try {
      const brut = stockage.get(STORAGE_KEY_COLLECTION);
      const liste = brut ? JSON.parse(brut) : [];
      return Array.isArray(liste) ? liste.filter((cle) => typeof cle === "string") : [];
    } catch (e) {
      return [];
    }
  }

  const collection = new Set(lireCollection());
  const cleFiche = (type, id) => type + ":" + id;
  const estVu = (type, id) => collection.has(cleFiche(type, id));

  /** Compte les fiches vues par famille, à partir des clés « type:id ». */
  function compterCollection() {
    const compte = { stand: 0, perso: 0 };
    collection.forEach((cle) => {
      const type = cle.slice(0, cle.indexOf(":"));
      if (compte[type] !== undefined) compte[type] += 1;
    });
    return compte;
  }

  function majCompteursCollection() {
    const compte = compterCollection();
    const zones = [
      ["#collectionStands", compte.stand, D.stands.length, "Stands découverts"],
      ["#collectionPerso", compte.perso, D.personnages.length, "Personnages découverts"],
    ];
    zones.forEach(([selecteur, vus, total, libelle]) => {
      const zone = $(selecteur);
      if (!zone) return;
      zone.replaceChildren(
        frag([
          document.createTextNode("Collection : "),
          h("b", { text: vus + " / " + total }),
          document.createTextNode(" " + libelle),
        ])
      );
    });
  }

  /** Enregistre une fiche comme vue et met à jour son étoile dans la grille. */
  function marquerFicheVue(type, id) {
    if (collection.has(cleFiche(type, id))) return;
    collection.add(cleFiche(type, id));
    stockage.set(STORAGE_KEY_COLLECTION, JSON.stringify(Array.from(collection)));
    majCompteursCollection();
    const grille = type === "stand" ? "#grilleStands" : "#grillePersonnages";
    const carte = document.querySelector(grille + ' .card[data-id="' + id + '"]');
    if (carte) carte.classList.add("is-vu");
  }

  /* 9. Initialisation ------------------------------------------------- */

  function debounce(fn, delai) {
    let id;
    return function (...args) {
      clearTimeout(id);
      id = setTimeout(() => fn.apply(this, args), delai);
    };
  }

  function initialiser() {
    modale.init();
    initialiserDecor();

    const themeEnregistre = stockage.get(STORAGE_KEY_THEME);
    const themeActuel = themeEnregistre === "hamon" ? "hamon" : "stand";
    appliquerTheme(themeActuel);

    $("#themeToggle").addEventListener("click", () => {
      appliquerTheme(document.documentElement.dataset.theme === "stand" ? "hamon" : "stand");
    });

    $("#burger").addEventListener("click", () => {
      const nav = $("#nav");
      const ouvert = nav.classList.toggle("is-open");
      $("#burger").setAttribute("aria-expanded", String(ouvert));
    });

    $("#btnOra").addEventListener("click", () => { lancerCri("ora"); jouerCri("ora"); });
    $("#btnMuda").addEventListener("click", () => { lancerCri("muda"); jouerCri("muda"); });

    $$(".starter").forEach((bouton) => {
      bouton.addEventListener("click", () => {
        window.location.hash = "#/" + bouton.dataset.jump;
      });
    });

    const champPerso = $("#recherchePerso");
    champPerso.addEventListener("input", debounce(() => {
      filtrePerso.q = champPerso.value;
      rendrePersonnages();
    }, 120));

    const champStand = $("#rechercheStand");
    champStand.addEventListener("input", debounce(() => {
      filtreStand.q = champStand.value;
      rendreStands();
    }, 120));

    const form = $("#formGenerateur");
    form.addEventListener("submit", soumettreGenerateur);
    form.addEventListener("reset", () => $("#carteStandGenere").replaceChildren());

    // Duel de Stands : sélection, raccourcis et deep link (#/duel/<a>/<b>).
    [ "#duelSelectA", "#duelSelectB" ].forEach((selecteur) => {
      $(selecteur).addEventListener("change", () => {
        lancerDuel($("#duelSelectA").value, $("#duelSelectB").value);
      });
    });

    $("#duelLancer").addEventListener("click", () => {
      lancerDuel($("#duelSelectA").value, $("#duelSelectB").value);
    });

    $("#duelEchanger").addEventListener("click", () => {
      lancerDuel($("#duelSelectB").value, $("#duelSelectA").value);
    });

    // Le tirage des combattants est aléatoire, le combat lui-même reste
    // déterministe : la même paire donnera toujours la même issue.
    const paireAleatoire = (rng) => {
      const i = Math.floor(rng() * D.stands.length);
      let j = Math.floor(rng() * D.stands.length);
      if (j === i) j = (j + 1) % D.stands.length;
      return [D.stands[i].id, D.stands[j].id];
    };

    $("#duelSurprise").addEventListener("click", () => {
      lancerDuel.apply(null, paireAleatoire(Math.random));
    });

    $("#duelJour").addEventListener("click", () => {
      // Une seule paire par jour, identique pour tous les visiteurs.
      const auj = new Date();
      const cle = auj.getFullYear() + "-" + (auj.getMonth() + 1) + "-" + auj.getDate();
      lancerDuel.apply(null, paireAleatoire(genererSuite(empreinte("duel-du-jour|" + cle))));
    });

    // Finitions : cris synthétisés, easter egg ZA WARUDO, roulettes, collection.
    appliquerSon(stockage.get(STORAGE_KEY_SON) === "on", true);
    $("#sonToggle").addEventListener("click", () => appliquerSon(!son.actif));
    initialiserZaWarudo();
    majCompteursCollection();

    $("#standAuHasard").addEventListener("click", () => {
      lancerRoulette(standsFiltres(), $("#standAuHasard"), ouvrirStand);
    });
    $("#persoAuHasard").addEventListener("click", () => {
      lancerRoulette(personnagesFiltres(), $("#persoAuHasard"), ouvrirPersonnage);
    });

    window.addEventListener("hashchange", () => afficher(vueDepuisHash()));
    afficher(vueDepuisHash(), { sansScroll: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiser);
  } else {
    initialiser();
  }
}());
