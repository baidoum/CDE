/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/sftp', 'N/file', 'N/log', 'N/config'], 
function (sftp, file, log, config) {

    /**
     * Chargement des préférences WMS depuis Company Preferences
     */
    function getWmsPrefs() {
        log.audit('WMS PREFS', 'Chargement des préférences via COMPANY_PREFERENCES...');

        var prefs = config.load({
            type: config.Type.COMPANY_PREFERENCES
        });

        var result = {
            host:      prefs.getValue('custscript_wms_sftp_host'),
            port:      prefs.getValue('custscript_wms_sftp_port'),
            username:  prefs.getValue('custscript_wms_sftp_username'),
            secretId:  prefs.getValue('custscript_wms_sftp_secret_id'),
            hostKey:   prefs.getValue('custscript_wms_sftp_hostkey'),
            directory: prefs.getValue('custscript_wms_sftp_directory'),
            ownerCode: prefs.getValue('custscript_wms_owner_code')
        };

        // LOG DÉTAILLÉ
        log.debug('WMS PREFS (RAW)', result);

        // Vérification des valeurs manquantes
        var missing = [];
        Object.keys(result).forEach(function (k) {
            if (!result[k]) missing.push(k);
        });

        if (missing.length > 0) {
            log.error('WMS PREFS - CHAMPS MANQUANTS', 
                'Les préférences suivantes sont vides: ' + missing.join(', ')
            );
        } else {
            log.audit('WMS PREFS', 'Toutes les préférences sont correctement renseignées.');
        }

        return result;
    }

    /**
     * Upload d’un fichier vers SFTP
     */
    function uploadFile(options) {
        var fileId = options && options.fileId;
        var overrideDir = options && options.directory;

        if (!fileId) {
            return { success: false, message: 'fileId manquant pour l’upload SFTP' };
        }

        // Lecture des préférences
        var wms = getWmsPrefs();

        // Log de synthèse avant tentative de connexion
        log.audit('SFTP Upload INIT', {
            host: wms.host,
            port: wms.port,
            username: wms.username,
            secretId: wms.secretId,
            directory: overrideDir || wms.directory
        });

        if (!wms.host || !wms.username || !wms.secretId) {
            var msg = 'Préférences SFTP incomplètes. Vérifie host, username, secretId.';
            log.error('SFTP Upload ABORT', msg);
            return { success: false, message: msg };
        }

        try {
            var fileObj  = file.load({ id: fileId });
            var fileName = fileObj.name;

            log.debug('SFTP Upload - File loaded', {
                fileId: fileId,
                fileName: fileName
            });

            // Tentative de connexion
            log.audit('SFTP CONNECT', {
                host: wms.host,
                port: wms.port,
                directory: overrideDir || wms.directory
            });

            var conn = sftp.createConnection({
                username:  wms.username,
                secret:    wms.secretId,
                url:       wms.host,
                port:      parseInt(wms.port || 22, 10),
                directory: overrideDir || wms.directory,
                hostKey:   wms.hostKey
            });

            log.audit('SFTP CONNECT SUCCESS', {
                host: wms.host,
                directory: overrideDir || wms.directory
            });

            // Upload
            conn.upload({
                filename: fileName,
                file: fileObj
            });

            log.audit('SFTP Upload SUCCESS', fileName);

            return {
                success: true,
                message: 'Fichier envoyé avec succès'
            };

        } catch (e) {
            log.error('SFTP Upload FAILED', {
                name: e.name,
                message: e.message,
                stack: e.stack
            });
            return {
                success: false,
                message: e.message || String(e)
            };
        }
    }

    return {
        getWmsPrefs: getWmsPrefs,
        uploadFile: uploadFile
    };
});
