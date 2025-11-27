/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/sftp', 'N/file', 'N/log', 'N/runtime'], function (sftp, file, log, runtime) {

    /**
     * Upload d'un fichier du File Cabinet vers un SFTP.
     *
     * @param {Object} options
     * @param {number|string} options.fileId       - ID du fichier NetSuite
     * @param {string} [options.directory]         - Dossier distant (/IN par défaut)
     * @returns {{success: boolean, message: string}}
     */
    function uploadFile(options) {
        var fileId    = options.fileId;
        var directory = options.directory || '/IN';

        if (!fileId) {
            return { success: false, message: 'fileId manquant' };
        }

        try {
            var script = runtime.getCurrentScript();

            // ⚙️ Idéalement : tout vient de paramètres de script
            var username = script.getParameter({ name: 'custscript_cde_sftp_username' });
            var secretId = script.getParameter({ name: 'custscript_cde_sftp_secret' });
            var url      = script.getParameter({ name: 'custscript_cde_sftp_url' });
            var port     = script.getParameter({ name: 'custscript_cde_sftp_port' });
            var hostKey  = script.getParameter({ name: 'custscript_cde_sftp_hostkey' });

            // En fallback, tu peux temporairement garder des valeurs en dur (mais à éviter) :
            // username = username || 'SifLegrandgrp';
            // secretId = secretId || 'custsecret_sftp_hillebrand_pwd_prod';
            // url      = url      || 'SFTP.Hillebrand.com';
            // port     = port     || 2222;
            // hostKey  = hostKey  || 'AAAAB3NzaC1yc2EAAAADAQABAAAAgQDD...';

            var fileObj  = file.load({ id: fileId });
            var fileName = fileObj.name;

            log.debug('SFTP Upload - file', { fileId: fileId, fileName: fileName });

            var conn = sftp.createConnection({
                username: username,
                secret:   secretId,
                url:      url,
                port:     parseInt(port || 22, 10),
                directory: directory,
                hostKey:  hostKey
            });

            log.debug('SFTP Upload - connection OK', { url: url, directory: directory });

            conn.upload({
                filename: fileName,
                file: fileObj
            });

            log.debug('SFTP Upload', 'Upload OK pour ' + fileName);

            return {
                success: true,
                message: 'Fichier envoyé avec succès'
            };

        } catch (e) {
            log.error('SFTP Upload FAILED', 'Erreur : ' + e.name + ' - ' + e.message);
            return {
                success: false,
                message: e.message || String(e)
            };
        }
    }

    return {
        uploadFile: uploadFile
    };
});
