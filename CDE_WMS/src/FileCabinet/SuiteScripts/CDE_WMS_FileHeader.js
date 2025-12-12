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
        ITEM: 1,
        SALES_ORDER: 2,
        PURCHASE_ORDER: 3
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

        HEADERS_BY_TOPIC[TOPIC.SALES_ORDER] = [
        'Owner',                // 1
        'Site',                 // 2
        'OrderNumber',          // 3
        'OrderDate',            // 4
        'DueDate',              // 5
        'CustomerBillTo',       // 6
        'CBTCompanyName',       // 7
        'CBTAddress1',          // 8
        'CBTAddress2',          // 9
        'CBTAddress3',          // 10
        'CBTZipCode',           // 11
        'CBTCity',              // 12
        'CBTState',             // 13
        'CBTCountry',           // 14
        'CBTContact',           // 15
        'CBTVoicePhone',        // 16
        'CBTFaxPhone',          // 17
        'CBTEmail',             // 18
        'CustomerShipTo',       // 19
        'CSTCompanyName',       // 20
        'CSTAddress1',          // 21
        'CSTAddress2',          // 22
        'CSTAddress3',          // 23
        'CSTZipCode',           // 24
        'CSTCity',              // 25
        'CSTState',             // 26
        'CSTCountry',           // 27
        'CSTContact',           // 28
        'CSTVoicePhone',        // 29
        'CSTFaxPhone',          // 30
        'CSTEmail',             // 31
        'Carrier',              // 32
        'ShippingMethod',       // 33
        'Commentaire',          // 34
        'LineNumber',           // 35
        'ItemNumber',           // 36
        'OrderedQuantity',      // 37
        'Comment',              // 38
        'Enseigne',             // 39
        'KitouComposant',       // 40
        'KitItemNumber',        // 41
        'KitLineNumber',        // 42
        'NbParkit',             // 43
        'PointRelais',          // 44
        'Tournee',              // 45 (Tournée)
        'Zone',                 // 46
        'UnitOfMeasure',        // 47
        'SoucheOrderERP',       // 48
        'CodeRepresentant',     // 49
        'NomRepresentant',      // 50
        'CodeLangueBL',         // 51
        'CodeLangueLC',         // 52
        'CodePaysISO2',         // 53
        'CodePaysISO3',         // 54
        'CustomerDocument',     // 55
        'CCorderNumber',        // 56
        'TypeDocument',         // 57 (Type de document ERP)
        'PrixNet',              // 58
        'PrixBrut',             // 59
        'TauxTVA',              // 60
        'QuantiteUV',           // 61
        'UV',                   // 62
        'CodeArticleAfficher',  // 63
        'CodeOrigineCommande',  // 64
        'CodeConditionLivraison', // 65
        'NumeroPalette',        // 66
        'LotNumber',            // 67 (Numéro de Lot)
        'Couleur',              // 68
        'CommandeClient',       // 69
        'CustomerItemNumber',   // 70
        'CustomerDescription1', // 71
        'CustomerDescription2', // 72
        'DoitEtreImprimeBL',    // 73
        'ItemSuffixe',          // 74
        'TransitTo',            // 75
        'TransitCompanyName',   // 76
        'TransitAddress1',      // 77
        'TransitAddress2',      // 78
        'TransitAddress3',      // 79
        'TransitZipCode',       // 80
        'TransitCity',          // 81
        'TransitState',         // 82
        'TransitCountry',       // 83
        'TransitContact',       // 84
        'TransitVoicePhone',    // 85
        'TransitFaxPhone',      // 86
        'TransitMobilePhone',   // 87
        'TransitEmail',         // 88
        'TransitCodePaysISO2',  // 89
        'TransitCodePaysISO3',  // 90
        'CommentaireClient',    // 91
        'CommentaireTransporteur', // 92
        'CommentaireLogistique',// 93
        'SaisiPar',             // 94
        'NumeroFacture',        // 95
        'ImpressionFacture',    // 96
        'PriseRDV',             // 97
        'Hayon',                // 98
        'ContactsLivraison',    // 99
        'EmailLivraison',       // 100
        'TypeClient',           // 101
        'CBTMobilePhone',       // 102
        'CSTMobilePhone',       // 103
        'ShipDate',             // 104
        'TypeTransporteur',     // 105
        'Reserve1',             // 106
        'CSTCodeEDI',           // 107
        'CSTCodeEDIFournisseur',// 108
        'ColisageAutorise',     // 109
        'TypePrepa',            // 110
        'Priorite',             // 111
        'Regroupement',         // 112
        'Affectation',          // 113
        'VagueMultiBon',        // 114
        'Reserve2',             // 115
        'UniteMesureAPreparer', // 116
        'MontantAssurance',     // 117
        'MontantFraisPortHT',   // 118
        'MontantProduitHT',     // 119
        'MontantFactureTTC',    // 120
        'FacturePDF',           // 121
        'CBTCodeEDI',           // 122
        'NombrePetrin',         // 123
        'QuantiteParPetrin',    // 124
        'ToleranceMoins',       // 125
        'TolerancePlus',        // 126
        'OFPesee',              // 127
        'CodeRecette',          // 128
        'CoefficientConsommation', // 129
        'Poste',                // 130
        'CustomerDueDate',      // 131
        'CustomerOrderedQuantity', // 132
        'DateFacture',          // 133
        'DateDocument',         // 134
        'NumeroSerie',          // 135
        'ReferenceCommandeLigne', // 136
        'CategorieEnvoiColissimo', // 137
        'CodeFournisseur',      // 138
        'DeviseFacture',        // 139
        'ExtendedAPreparer',    // 140
        'CodeFabricant',        // 141
        'LineNumberERP',        // 142
        'TexteConformite',      // 143
        'TexteComplementaire',  // 144
        'CertificatNumero'      // 145
    ];

    // -------------------------------------
    // Headers pour les Purchase Orders (RO)
    // -------------------------------------
    HEADERS_BY_TOPIC[TOPIC.PURCHASE_ORDER] = [
        'Owner',                    // 1  - ro_Owner
        'Site',                     // 2  - Site
        'OrderNumber',              // 3  - OrderNumber
        'OrderDate',                // 4  - AAAAMMJJ
        'DueDate',                  // 5  - AAAAMMJJ
        'VendorID',                 // 6  - VendorID
        'Carrier',                  // 7  - Transporteur
        'Commentaire',              // 8  - Commentaire entête
        'LineNumber',               // 9  - LineNumber
        'ItemNumber',               // 10 - ItemNumber
        'OrderedQuantity',          // 11 - OrderedQuantity
        'Comment',                  // 12 - Comment ligne
        'VendorName',               // 13 - Nom du fournisseur
        'UnitOfMeasure',            // 14 - UnitofMeasure
        'SoucheOrderERP',           // 15 - SoucheOrderERP
        'OrderType',                // 16 - Type de bon (OrderType)
        'TypeDocument',             // 17 - Type de document ERP (RO_TypedocumentERP)
        'NumeroContainer',          // 18 - RO_NumeroContainer
        'CAOrderNumberLine',        // 19 - Commande Achat au niveau de la ligne (CAOrderNumber)
        'CALineNumber',             // 20 - Ligne commande achat (CALineNumber)
        'ReferenceFournisseur',     // 21 - RD_ReferenceFournisseur
        'ReferenceExterne',         // 22 - RD_ReferenceExterne
        'CCOrderNumber',            // 23 - RD_CCOrderNumber
        'CCLineNumber',             // 24 - RD_CCLineNumber
        'ItemSuffixe',              // 25 - ItemSuffixe
        'ItemDescription',          // 26 - Item.Description
        'ItemVariante',             // 27 - Item.Itm_Variante
        'PrixUnitaireNet',          // 28 - PrixUnitaireNet
        'SiteERP',                  // 29 - Site ERP
        'CAOrderNumberHeader',      // 30 - Commande Achat au niveau de l’en-tête (CAOrderNumber)
        'VendorShippingOrderNumber',// 31 - RD_VendorShippingOrderNumber
        'VendorShippingLineNumber', // 32 - RD_VendorShippingLineNumber
        'CodeSociete',              // 33 - Code société
        'VendorOrderNumber',        // 34 - VendorOrderNumber
        'LotNumber',                // 35 - Numéro de Lot
        'LineNumberERP',            // 36 - LineNumberERP
        'Indice',                   // 37 - Indice bon
        'ExpirationDate',           // 38 - RD.ExpirationDate (AAAAMMJJ)
        'QuantiteUA',               // 39 - RD_QteUA
        'RDExtended',               // 40 - RD_Extended
        'CodeDepotERPLine',         // 41 - RD_CodeDepotERPLine
        'RDIdControl',              // 42 - RD_IdControl
        'Reserve',                  // 43 - Réservé Pixi
        'RDCertificatRevision',     // 44 - RD_CertificatRevision
        'RDCertificatDateReception' // 45 - RD_CertificatDateReception (AAAAMMJJ)
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
         * Retourne le nom complet du fichier à générer pour un topic donné.
         * Format : <PREFIX><OWNER_CODE><YYYYMMDDhhmmss>.txt
         *
         * Exemple : ARTXXXXXX20251106163545.txt
         */
        function buildFileName(topic) {
            // Codes WMS attendus par type de flux
            const FILE_PREFIX_BY_TOPIC = {
                [TOPIC.ITEM]: 'ART',      // Articles
                [TOPIC.SALES_ORDER]: 'PREP',
                [TOPIC.PURCHASE_ORDER]: 'RECEP'
                // [TOPIC.MOV]: 'MOV',    // Mouvements
                // [TOPIC.TRANSFER]: 'TRA' // Transferts
            };

            const OWNER_CODE = 'LCDE';  // Code du donneur d’ordre → à rendre paramétrable plus tard
            const EXTENSION  = '.csv';
            const timestamp  = formatTimestamp(new Date());

            // Si le topic n’est pas trouvé, on met un préfixe générique
            const prefix = FILE_PREFIX_BY_TOPIC[topic] || 'WMS';

            return `${prefix}${OWNER_CODE}${timestamp}${EXTENSION}`;
        }

        /**
         * Helper pour timestamp : YYYYMMDDhhmmss
         */
        function formatTimestamp(d) {
            const yyyy = d.getFullYear();
            const MM = pad2(d.getMonth() + 1);
            const dd = pad2(d.getDate());
            const hh = pad2(d.getHours());
            const mm = pad2(d.getMinutes());
            const ss = pad2(d.getSeconds());
            return `${yyyy}${MM}${dd}${hh}${mm}${ss}`;
        }

        function pad2(n) {
            return (n < 10 ? '0' : '') + n;
        }


    return {
        TOPIC: TOPIC,
        getHeaderColumns: getHeaderColumns,
        buildHeaderLine: buildHeaderLine,
        buildFileName: buildFileName
    };
});
