/**
 * MT Delivery – enregistrement des formulaires du site dans cette Google Sheet.
 *
 * Installation (une seule fois) :
 * 1. Dans la Google Sheet « MT Delivery – Demandes » : Extensions › Apps Script.
 * 2. Remplacez tout le code par celui-ci.
 * 3. Enregistrez, puis Déployer › Nouveau déploiement › type « Application Web »
 *    – Exécuter en tant que : Moi
 *    – Qui a accès : Tout le monde
 *    Autorisez l'accès quand Google le demande, puis copiez l'URL de l'application Web.
 * 4. Dans Cloudflare (projet mtdelivery › Settings › Variables and secrets), ajoutez :
 *    – SHEET_URL (type Secret) = l'URL copiée à l'étape 3 (gardez-la privée : elle permet d'écrire dans la feuille)
 *
 * Chaque formulaire envoyé sur mtdelivery.pages.dev ajoute une ligne dans l'onglet correspondant.
 * Les onglets et leurs titres de colonnes sont créés automatiquement au premier envoi.
 */

// Facultatif : un code secret partagé avec Cloudflare (variable SHEET_TOKEN). Laissez vide pour ne pas l'utiliser.
const TOKEN = '';

// Identifiant de la Google Sheet « MT Delivery – Demandes » (dans son adresse, entre /d/ et /edit).
const SHEET_ID = '1qn1dtLI6HW5CPDK5q9kgXzg-fqmuFTBHYVQszZeiEQw';

const ONGLETS = {
  expediteur: {
    nom: 'Expéditeurs',
    colonnes: ['Date', 'N° demande', 'Statut', 'Nom', 'Prénom', 'Téléphone', 'E-mail', 'Boutique', 'Secteur', 'Adresse', "Pièce d'identité reçue", 'Remarques'],
    valeurs: d => [d.nom, d.prenom, d.tel, d.email, d.boutique, d.secteur, d.adresse, d.piece === 'oui', ''], // case cochée si une photo a été jointe (visible dans la page admin)
    caseACocher: 11, // colonne « Pièce d'identité reçue »
  },
  cod: {
    nom: 'Demandes COD',
    colonnes: ['Date', 'N° demande', 'Statut', 'Boutique', 'Téléphone', 'N° de suivi', 'Montant attendu (DA)', 'Remarques'],
    valeurs: d => [d.boutique, d.tel, d.suivis, d.montant ? Number(d.montant) : '', ''],
  },
  reclamation: {
    nom: 'Réclamations',
    colonnes: ['Date', 'N° demande', 'Statut', 'Nom', 'Téléphone', 'N° de suivi', 'Motif', 'Description', 'Remarques'],
    valeurs: d => [d.nom, d.tel, d.suivi, d.type, d.desc, ''],
  },
  avis: {
    nom: 'Avis',
    colonnes: ['Date', 'N° demande', 'Statut', 'Note', 'Prénom / boutique', 'Avis', 'Remarques'],
    valeurs: d => [d.note ? Number(d.note) : '', d.prenom, d.texte, ''],
  },
};

const STATUTS = ['nouveau', 'en cours', 'réglé'];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body || (TOKEN && body.token !== TOKEN)) return reponse({ ok: false, error: 'jeton invalide' });
    const dem = body.demande || {};
    if (dem.type === 'test') return reponse({ ok: true });
    const conf = ONGLETS[dem.type];
    if (!conf) return reponse({ ok: false, error: 'type inconnu' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const feuille = onglet(conf);
      const d = dem.data || {};
      // Les numéros de téléphone sont écrits en texte pour garder le 0 devant.
      const ligne = [new Date(dem.date || Date.now()), String(dem.id || '').replace('dem:', ''), dem.statut || 'nouveau']
        .concat(conf.valeurs(d).map(v => v === undefined || v === null ? '' : (typeof v === 'string' && /^0\d{8,9}$/.test(v)) ? "'" + v : v));
      feuille.appendRow(ligne);
    } finally {
      lock.releaseLock();
    }
    return reponse({ ok: true });
  } catch (err) {
    return reponse({ ok: false, error: String(err) });
  }
}

// Crée l'onglet avec ses titres, la liste des statuts et la case à cocher si besoin.
function onglet(conf) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let f = ss.getSheetByName(conf.nom);
  if (f) return f;
  f = ss.insertSheet(conf.nom);
  f.getRange(1, 1, 1, conf.colonnes.length).setValues([conf.colonnes])
    .setFontWeight('bold').setBackground('#0a2647').setFontColor('#ffffff');
  f.setFrozenRows(1);
  f.getRange('A2:A').setNumberFormat('dd/MM/yyyy HH:mm');
  f.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUTS, true).build());
  if (conf.caseACocher) f.getRange(2, conf.caseACocher, 999, 1).insertCheckboxes();
  f.autoResizeColumns(1, conf.colonnes.length);
  return f;
}

function reponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
