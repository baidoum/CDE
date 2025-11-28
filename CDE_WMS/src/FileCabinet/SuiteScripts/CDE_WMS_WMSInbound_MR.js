/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define([
    'N/runtime',
    'N/log',
    'N/sftp',
    'N/file',
    './CDE_WMS_SFTPUtil'
], function (runtime, log, sftp, file, SFTPUtil) {

    /**
     * Crée une connexion SFTP en réutilisant les préférences WMS.
     */
    function getSftpConnection() {
        var prefs = SFTPUtil.getWmsPrefs();

        if (!prefs.host || !prefs.username || !prefs.secretId) {
            throw new Error('Préférences SFTP incomplètes (host/username/secretId manquants)');
        }

        log.audit('WMS INBOUND - SFTP CONNECT', {
            host: prefs.host,
            port: prefs.port,
            directory: prefs.directory
        });

        var conn = sftp.createConnection({
            username:  prefs.username,
            secret:    prefs.secretId,               // ID du secret (custsecret_...)
            url:       prefs.host,
            port:      parseInt(prefs.port || 22, 10),
            directory: prefs.inboundDirectory,       // directory “par défaut” pour la connexion
            hostKey:   prefs.hostKey
        });

        log.audit('WMS INBOUND - SFTP CONNECT SUCCESS', {
            host: prefs.host
        });

        return conn;
    }

    /**
     * getInputData
     * - Liste les fichiers dans le répertoire /home/AXELIStoLCDE sur le SFTP
     * - Retourne un tableau d’objets { filename, directory, size }
     */
    function getInputData() {
        log.audit('WMS INBOUND - getInputData', 'Start');

        var script = runtime.getCurrentScript();

        // Param optionnel pour surcharger le répertoire SFTP (sinon valeur par défaut)
        

        var conn = getSftpConnection();

        var remoteDir = conn.inboundDirectory

        // Liste des fichiers dans le répertoire
        var entries;
        try {
            entries = conn.list({
                path: remoteDir
            });
        } catch (e) {
            log.error('WMS INBOUND - list error', {
                dir: remoteDir,
                error: e.message,
                stack: e.stack
            });
            return [];
        }

        log.debug('WMS INBOUND - entries', {
            dir: remoteDir,
            count: entries && entries.length
        });

        if (!entries || !entries.length) {
            log.audit('WMS INBOUND - getInputData', 'Aucun fichier à traiter dans ' + remoteDir);
            return [];
        }

        // On ne garde que les fichiers "normaux" (pas de . , .., ni répertoires)
        var files = entries
            .filter(function (entry) {
                return !entry.directory &&
                       entry.filename !== '.' &&
                       entry.filename !== '..';
            })
            .map(function (entry) {
                return {
                    filename: entry.filename,
                    directory: remoteDir,
                    size: entry.size
                };
            });

        log.audit('WMS INBOUND - files to process', {
            dir: remoteDir,
            count: files.length
        });

        return files;
    }

    /**
     * map
     * - Pour chaque fichier listé : le télécharge et le sauve dans le File Cabinet.
     */
    function map(context) {
        var data = JSON.parse(context.value);
        var filename  = data.filename;
        var directory = data.directory;

        log.audit('WMS INBOUND - MAP start', {
            filename: filename,
            directory: directory
        });

        var script = runtime.getCurrentScript();

        // ID du dossier "IN" dans le File Cabinet (paramètre de script)
        var inboundFolderId = script.getParameter({
            name: 'custscript_wms_inbound_folder'
        });

        if (!inboundFolderId) {
            log.error('WMS INBOUND - inbound folder manquant',
                'Paramètre custscript_wms_inbound_folder non renseigné');
            return;
        }

        try {
            var conn = getSftpConnection();

            // Téléchargement du fichier depuis le SFTP
            var remoteFile = conn.download({
                directory: directory,
                filename: filename
            });

            // On place le fichier dans le dossier IN
            remoteFile.folder = parseInt(inboundFolderId, 10);

            var fileId = remoteFile.save();

            log.audit('WMS INBOUND - file saved', {
                filename: filename,
                fileId: fileId,
                folderId: inboundFolderId
            });

            // 💡 OPTION FUTURE :
            // Ici, on pourrait :
            //  - soit supprimer le fichier du SFTP
            //  - soit le déplacer dans un répertoire d’archive
            // Pour l’instant on ne touche à rien côté SFTP, pour éviter les bêtises.

        } catch (e) {
            log.error('WMS INBOUND - MAP error', {
                filename: filename,
                directory: directory,
                error: e.message,
                stack: e.stack
            });
            return;
        }
    }

    function reduce(context) {
        // Pas besoin de reduce pour cette première phase :
        // on gère chaque fichier indépendamment dans map.
    }

    function summarize(summary) {
        log.audit('WMS INBOUND - summarize', {
            usage: summary.usage,
            concurrency: summary.concurrency,
            yields: summary.yields
        });

        summary.mapSummary.errors.iterator().each(function (key, error) {
            log.error('WMS INBOUND - map error', {
                key: key,
                error: error
            });
            return true;
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            log.error('WMS INBOUND - reduce error', {
                key: key,
                error: error
            });
            return true;
        });

        log.audit('WMS INBOUND', 'Terminé');
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
