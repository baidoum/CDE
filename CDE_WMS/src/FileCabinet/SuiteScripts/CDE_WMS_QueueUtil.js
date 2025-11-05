/**
 * @NApiVersion 2.x
 * @NModuleScope SameAccount
 * @NModuleType Library
 */
define(['N/record', 'N/log'], function (record, log) {

    var QUEUE_RECORD_TYPE = 'customrecord_cde_item_sync_queue';

    var FIELDS = {
        RECORD_TYPE: 'custrecord_sync_record_type',
        DATE_SYNC:   'custrecord_sync_item_date_sync',
        STATUS:      'custrecord_sync_status',
        FILE:        'custrecord_sync_file',
        RECORD_ID:   'custrecord_sync_record_id',
        TOPIC:       'custrecord_sync_topic',
        ITEM:        'custrecord_sync_item'
    };

    /**
     * ⚠️ STATUS = internal IDs de ta liste "CDE Status Sync WMS".
     * Mets ici les bonnes valeurs (exemple : 1 = PENDING, 2 = IN_PROGRESS, etc.).
     */
    var STATUS = {
        PENDING:     '1',
        IN_PROGRESS: '2',
        DONE:        '3',
        ERROR:       '4'
    };

    /**
     * ⚠️ TOPIC = internal IDs de ta liste "CDE Sync Type".
     * Mets ici la valeur qui correspond au type "ITEM".
     */
    var TOPIC = {
        ITEM: '1' // <-- à adapter à l'ID réel de la valeur "ITEM" dans CDE Sync Type
    };

    /**
     * Ajoute une ligne dans la file de synchronisation.
     *
     * @param {Object} options
     * @param {string} options.topic        → internalid de la valeur de liste (ex: TOPIC.ITEM)
     * @param {string} options.recordType   → type NetSuite (ex: 'inventoryitem')
     * @param {number|string} options.recordId → internalid NetSuite du record
     * @param {number|string} [options.itemId] → internalid de l’article (si applicable)
     * @returns {number} internalid du record de queue
     */
    function enqueue(options) {
        try {
            if (!options || !options.topic || !options.recordId) {
                throw new Error('enqueue: topic et recordId sont obligatoires');
            }

            var topic      = options.topic;
            var recordType = options.recordType || '';
            var recordId   = options.recordId;
            var itemId     = options.itemId || null;

            log.debug('CDE_WMS_QueueUtil.enqueue - start', {
                topic: topic,
                recordType: recordType,
                recordId: recordId,
                itemId: itemId
            });

            var queueRec = record.create({
                type: QUEUE_RECORD_TYPE,
                isDynamic: true
            });

            queueRec.setValue({
                fieldId: FIELDS.TOPIC,
                value: topic
            });

            if (recordType) {
                queueRec.setValue({
                    fieldId: FIELDS.RECORD_TYPE,
                    value: recordType
                });
            }

            // Texte → on stocke l’ID NetSuite
            queueRec.setValue({
                fieldId: FIELDS.RECORD_ID,
                value: String(recordId)
            });

            if (itemId) {
                queueRec.setValue({
                    fieldId: FIELDS.ITEM,
                    value: itemId
                });
            }

            // date du jour
            queueRec.setValue({
                fieldId: FIELDS.DATE_SYNC,
                value: new Date()
            });

            // statut initial = PENDING
            queueRec.setValue({
                fieldId: FIELDS.STATUS,
                value: STATUS.PENDING
            });

            var queueId = queueRec.save({
                enableSourcing: false,
                ignoreMandatoryFields: true
            });

            log.audit('CDE_WMS_QueueUtil.enqueue - queued', {
                queueId: queueId,
                topic: topic,
                recordId: recordId,
                itemId: itemId
            });

            return queueId;

        } catch (e) {
            log.error('CDE_WMS_QueueUtil.enqueue - ERROR', {
                message: e.message,
                stack: e.stack
            });
            throw e;
        }
    }

    return {
        enqueue: enqueue,
        STATUS: STATUS,
        TOPIC: TOPIC,
        FIELDS: FIELDS
    };
});
