/**
 * @NApiVersion 2.x
 * @NModuleScope SameAccount
 * @NModuleType Library
 *
 * Library dédiée à la définition des entêtes de fichiers WMS.
 * → Quand le WMS veut ajouter / supprimer / renommer une colonne,
 *   tu ne touches qu’à CE fichier.
 */
define([], function () {

    // Topics fonctionnels (doit rester cohérent avec CDE_WMS_QueueUtil.TOPIC)
    var TOPIC = {
        ITEM: 1
        // FUTUR : TRANSFER: 'TRANSFER', RECEIPT: 'RECEIPT', etc.
    };

    /**
     * Définition des entêtes par topic.
     * Chaque entrée est un ARRAY, l’ordre = l’ordre des colonnes dans le fichier.
     */
    var HEADERS_BY_TOPIC = {};

    // 🟦 Entêtes pour les ARTICLES (ITEM)
    // → Exactement les entêtes de la spec WMS, dans l’ordre 1..122
    HEADERS_BY_TOPIC[TOPIC.ITEM] = [
        'Owner',                               // 1  Itm_Owner
        'ItemNumber',                          // 2  ItemNumber
        'Description',                         // 3  Description
        'Description2',                        // 4  Description2
        'Description3',                        // 5  Description3
        'Description4',                        // 6  Description4
        'Description5',                        // 7  Description5
        'Type',                                // 8  Type (ne pas utiliser)
        'Kit',                                 // 9  KitMaster
        'Image',                               // 10 ItemImage
        'Comments',                            // 11 Comments
        'UsesSerialNo',                        // 12 UsesSerialNo
        'UsesLot',                             // 13 UsesLot
        'UsesDLV',                             // 14 UsesDLV
        'UsesDateFab',                         // 15 UsesDateFab
        'UsesDateRec',                         // 16 UsesDateRec
        'UsesDateLimiteVente',                 // 17 UsesDateLimiteVente (ne sert plus)
        'SurPalette',                          // 18 SurPalette
        'Zone',                                // 19 Zone
        'Classe',                              // 20 Classe
        'Famille',                             // 21 Famille
        'Marque',                              // 22 Marque
        'CodeDanger',                          // 23 CodeDanger
        'ReferenceERP',                        // 24 ReferenceERP
        'Status',                              // 25 Status
        'GestionERP',                          // 26 GestionERP
        'UnitOfMeasure',                       // 27 UnitOfMeasure
        'Gencod',                              // 28 Gencod
        'VendorID',                            // 29 VendorID
        'EachCount',                           // 30 EachCount
        'UnitCost',                            // 31 UnitCost
        'cube',                                // 32 cube
        'Weight',                              // 33 Weight
        'GrossWeight',                         // 34 GrossWeight
        'Largeur',                             // 35 Largeur
        'Longueur',                            // 36 Longueur
        'Hauteur',                             // 37 Hauteur
        'SerialNoPicking',                     // 38 SerialNoPicking
        'Itm_SurRecepPourcent',                // 39 Itm_SurRecepPourcent
        'Itm_SurPrepPourcent',                 // 40 Itm_SurPrepPourcent
        'UsesCarton',                          // 41 UsesCarton
        'Itm_SerialLuhn',                      // 42 Itm_SerialLuhn
        'GereStock',                           // 43 GereStock
        'UsesPoidsVariable',                   // 44 UsesPoidsVariable
        'IUOM_Receiving',                      // 45 IUOM_Receiving
        'IUOM_Picking',                        // 46 IUOM_Picking
        'IUOM_Inventory',                      // 47 IUOM_Inventory
        'IUOM_RetourClient',                   // 48 IUOM_RetourClient
        'Variante',                            // 49 Variante
        'GTIN',                                // 50 GTIN
        'ItemSuffixe',                         // 51 ItemSuffixe
        'GTIN Palette',                        // 52 Itm_GTIN_Palette
        'Contrat Date',                        // 53 Itm_ContratDate
        'TolerancePoidsVariable',              // 54 Itm_TolerancePoidsVariable
        'Gerbable',                            // 55 Itm_Gerbable
        'Type Palette',                        // 56 Itm_UsesTypePalette
        'Groupe emballage',                    // 57 ITM_GroupeEmballage
        'Classe Danger',                       // 58 ITM_ClasseDanger
        'Sous Famille',                        // 59 Itm_SousFamille
        'Modele',                              // 60 Itm_Modele
        'Mot directeur',                       // 61 Itm_MotDirecteur
        'CodeIntitule',                        // 62 Itm_CodeIntitule
        'Itm_Groupe',                          // 63 Itm_Groupe
        'Code Activité',                       // 64 Itm_CodeActivite
        'Contrôle Zone',                       // 65 Itm_CTRLZone
        'Contrôle Classe',                     // 66 Itm_CTRLClasse
        'Catégorie',                           // 67 Itm_Categorie
        'Encombrement',                        // 68 Itm_Encombrement
        'UniteContenue',                       // 69 Itm_UniteContenue
        'PourcentContenu',                     // 70 Itm_PourcentContenu
        'UsesTypeContenant',                   // 71 Itm_UsesTypeContenant
        'IUOM_RetourFournisseur',              // 72 IUOM_RetourFournisseur
        'IUOM_CodeEDI',                        // 73 IUOM_CodeEDI
        'IUOM_Contenant',                      // 74 IUOM_Contenant
        'IUOM_Fardelage',                      // 75 IUOM_Fardelage
        'IUOM_Status',                         // 76 IUOM_Status
        'IUOM_QuantiteContenue',               // 77 IUOM_QuantiteContenue
        'UniteQuantiteContenue',               // 78 UniteQuantiteContenue
        'ContratDatefournisseur',              // 79 ContratDatefournisseur
        'VendorCodePays',                      // 80 ITM_PaysOrigine
        'Deconditionnable Detaillable',        // 81 IUOM_Deconditionnable
        'ReferenceFournisseur',                // 82 IUOM_ReferenceFournisseur
        'Gestion des statuts',                 // 83 Itm_Status
        'Statut en Réception',                 // 84 Itm_StatusReception
        'Code douanier',                       // 85 Itm_NumeroTarifaire
        'Statut préparation',                  // 86 Itm_StatusPreparation
        'IUOM_UPC',                            // 87 IUOM_UPC
        'Suivi T2A',                           // 88 (T2A)
        'UsesSerialNoERP',                     // 89 Itm_UsesSerialNoERP
        'UsesLotERP',                          // 90 Itm_UsesLotERP
        'UsesDLVERP',                          // 91 Itm_UsesDLVERP
        'Seuil Prélèvement SurStock',          // 92 ITM_SeuilPrelevementSurStock
        'Quantité par Palette',                // 93 NbArticlePallet
        'Quantité Conditionnement',            // 94 IUOM_QuantiteConditionnement
        'Libellé Unité de Mesure',             // 95 IUOM_Libelle
        'Numéro Appel d’offre',                // 96 Itm_AppelOffre
        'Ligne Appel d’Offre',                 // 97 Itm_LigneAppelOffre
        'Code société',                        // 98 (plateforme logistique)
        'Lot fournisseur',                     // 99 UsesLot
        'Nb Couche Palette',                   // 100
        'Nb Carton Palette',                   // 101
        'Poids Net Palette',                   // 102
        'Poids Brut Palette',                  // 103
        'Longueur Palette',                    // 104
        'Largeur Palette',                     // 105
        'Hauteur Palette',                     // 106
        'Durée de vie',                        // 107 Itm_DureeVie
        'Statut en Retour Client',             // 108 Itm_StatusRetourClient
        'Code Nature de l’article',            // 109 Itm_CodeNature
        'Vin - Couleur',                       // 110 Itm_VinCouleur
        'Vin - Millésime',                     // 111 Itm_VinMillesime
        'Vin – Zone élevage',                  // 112 Itm_VinZoneElevage
        'Vin – Code manipulation',             // 113 Itm_VinCodeManipulation
        'Vin - Appellation',                   // 114 Itm_VinAppellation
        'Vin – Code produit Accise',           // 115 Itm_CodeProduitAccise
        'Vin – CRD',                           // 116 Itm_CRD
        'Contenance de l’article',             // 117 Itm_QuantiteContenue
        'Unité de la contenance de l’article', // 118 Itm_UniteQuantiteContenue
        'Itm_UsesExtended',                    // 119 Itm_UsesExtended
        'Itm_VisibleDO',                       // 120 Itm_VisibleDO
        'Itm_ ImprimeEtqPreparation',          // 121 Itm_ ImprimeEtqPreparation
        'Itm_IdERP'                            // 122 Itm_IdERP
    ];

    /**
     * Retourne le tableau de noms de colonnes pour un topic donné.
     * @param {string} topic
     * @returns {string[]}
     */
    function getHeaderColumns(topic) {
        if (!topic || !HEADERS_BY_TOPIC[topic]) {
            throw new Error('CDE_WMS_FileHeader.getHeaderColumns: topic inconnu ou non configuré : ' + topic);
        }
        return HEADERS_BY_TOPIC[topic];
    }

    /**
     * Construit la ligne d’entête (string) avec le séparateur souhaité (par défaut ';').
     *
     * @param {string} topic
     * @param {string} [separator=';']
     * @returns {string} ex: "Owner;ItemNumber;Description;..."
     */
    function buildHeaderLine(topic, separator) {
        var sep = separator || ';';
        var cols = getHeaderColumns(topic);
        return cols.join(sep);
    }

    /**
     * (Optionnel) Préfixe de nom de fichier par topic.
     * Pratique si tu veux des noms de fichiers standardisés côté WMS.
     */
    function getFileNamePrefix(topic) {
        switch (topic) {
            case TOPIC.ITEM:
                return 'ITEM_EXPORT_';
            default:
                return 'WMS_EXPORT_';
        }
    }

    return {
        TOPIC: TOPIC,
        getHeaderColumns: getHeaderColumns,
        buildHeaderLine: buildHeaderLine,
        getFileNamePrefix: getFileNamePrefix
    };
});
