/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/sftp', 'N/file', 'N/log', 'N/config','./CDE_WMS_QueueUtil'], 
function (record, sftp, file, log, config, QueueUtil) {

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

    
    function markQueueStatus(queueId, statusId, errorMsg) {
        var values = { custrecord_sync_status: statusId };
        if (errorMsg) {
            values.custrecord_sync_error = String(errorMsg).substring(0, 300);
        }

        record.submitFields({
            type: 'customrecord_cde_item_sync_queue',
            id: queueId,
            values: values,
            options: { enableSourcing: false, ignoreMandatoryFields: true }
        });
    }

    
    // -------- Fonction haut niveau : création fichier + upload + MAJ queue --------
    /**
     * @param {Object} opts
     * @param {string} opts.fileName
     * @param {string} opts.fileContent
     * @param {number|string} opts.folderId
     * @param {Array<string|number>} opts.queueIdsDone
     * @param {Array<string|number>} opts.queueIdsError
     * @param {string} [opts.logPrefix]    ex: 'ITEM EXPORT', 'SO EXPORT'
     * @param {string} [opts.fileType]     ex: file.Type.CSV, file.Type.PLAINTEXT
     */
    function exportFileAndSend(opts) {
        var fileName      = opts.fileName;
        var fileContent   = opts.fileContent;
        var folderId      = parseInt(opts.folderId, 10);
        var queueIdsDone  = opts.queueIdsDone || [];
        var queueIdsError = opts.queueIdsError || [];
        var logPrefix     = opts.logPrefix || 'EXPORT';
        var fileType      = opts.fileType || file.Type.CSV;

        try {
            // 1) Création du fichier
            var fileObj = file.create({
                name: fileName,
                fileType: fileType,
                contents: fileContent,
                folder: folderId
            });

            var fileId = fileObj.save();

            log.audit(logPrefix + ' - file created', {
                fileId: fileId,
                fileName: fileName,
                folderId: folderId
            });

            // 2) Upload SFTP
            log.audit(logPrefix + ' - SFTP upload start', { fileId: fileId, fileName: fileName });

            var uploadRes = uploadFile({ fileId: fileId });

            if (!uploadRes || !uploadRes.success) {
                var errMsg = (uploadRes && uploadRes.message) || 'SFTP upload failed (résultat vide)';
                log.error(logPrefix + ' - SFTP upload error', errMsg);

                queueIdsDone.concat(queueIdsError).forEach(function (id) {
                    markQueueStatus(id, QueueUtil.STATUS.ERROR, 'SFTP: ' + errMsg);
                });

                return { success: false, message: errMsg };
            }

            log.audit(logPrefix + ' - SFTP upload success', uploadRes.message || 'OK');

            // 3) MAJ des queues
            queueIdsDone.forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.SENT);
                linkQueueToFile(id, fileId);
            });

            queueIdsError.forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.ERROR);
            });

            return {
                success: true,
                fileId: fileId,
                message: uploadRes.message || 'OK'
            };

        } catch (eFile) {
            log.error(logPrefix + ' - file save / SFTP error', {
                error: eFile.message,
                stack: eFile.stack
            });

            var errMsg = eFile.message || String(eFile);

            queueIdsDone.concat(queueIdsError).forEach(function (id) {
                markQueueStatus(id, QueueUtil.STATUS.ERROR, errMsg);
            });

            return { success: false, message: errMsg };
        }
    }

    function linkQueueToFile(queueId, fileId) {
        record.submitFields({
            type: 'customrecord_cde_item_sync_queue',
            id: queueId,
            values: { custrecord_sync_file: fileId },
            options: { enableSourcing: false, ignoreMandatoryFields: true }
        });
    }

    return {
        getWmsPrefs: getWmsPrefs,
        uploadFile: uploadFile,
        exportFileAndSend: exportFileAndSend
    };
});
