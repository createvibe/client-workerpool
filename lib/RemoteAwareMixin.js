/*
 * This file is part of the client-workerpool module.
 * 
 * (c) Anthony Matarazzo <email@anthonymatarazzo.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * The master thread id
 * @type {string}
 */
const MASTER_THREAD = 'master';

/**
 * RemoteAwareMixin provides a public interface to communicate with siblings
 *
 * "Remote" means on a separate process thread
 * 
 * @param {Function} superclass The super class you want to extend
 */
export const RemoteAwareMixin = superclass => class RemoteAwareMixin extends (superclass || class { }) {

    /**
     *
     * @constructor
     */
    constructor() {
        super(...arguments);
        this.id = null;
        this.remotes = {};
        this.callbacks = {};
        this.remoteKey = 0;
    }

    /**
     * Get the master thread value
     * @returns {string}
     */
    get MASTER_THREAD() {
        return MASTER_THREAD;
    }

    /**
     * See if a thread id / key is for master
     * @param {String} threadKey
     * @returns {boolean}
     */
    isMasterThread(threadKey) {
        return threadKey === MASTER_THREAD;
    }

    /**
     * See if a thread id / key is for this thread
     * @param {String} threadKey
     * @returns {boolean}
     */
    isThisThread(threadKey) {
        return threadKey === this.id;
    }

    /**
     * Get the next worker id to send a message to
     * @returns {string}
     */
    getNextRemoteKey() {
        const keys = Object.keys(this.remotes);
        const key = keys[this.remoteKey];
        if (this.remoteKey >= keys.length - 1) {
            this.remoteKey = 0;
        } else {
            this.remoteKey += 1;
        }
        return key;
    }

    /**
     * See if there are any remote workers (siblings) in the same cluster as ours
     * @returns {boolean}
     */
    hasRemotes() {
        return this.remotes.length !== 0;
    }

    /**
     * Broadcast a data payload to all workers in the cluster
     * @param {*} data The data to send to the workers
     * @param transferable
     * @returns {void}
     */
    broadcast(data, transferable) {
        for (const key in this.remotes) {
            this.sendMessageToRemote(key, data, transferable);
        }
    }

    /**
     * Send a message to a specific remote worker by key
     * @param {String} threadId The id of the remote worker
     * @param {Object} data The data to send
     * @param {Object[]} [transferable] Transferrable objects to send to the worker (MessagePort, etc)
     * @returns {boolean}
     */
    sendMessageToRemote(threadId, data = {}, transferable = undefined) {
        if (threadId in this.remotes) {
            if (typeof data === 'object') {
                data.thread = this.id;
            }
            // TODO: I think shared workers have an origin param, to support them this needs to be flexible
            data = JSON.parse(JSON.stringify(data));
            this.remotes[threadId].postMessage(data, transferable);
            return true;
        }
        return false;
    }

    /**
     * Post a message to the next available remote worker in the same cluster (similar to postMessage but for the next available remote worker)
     * @param {*} data The data to send to the worker
     * @param {Object[]} [transferable] Transferable objects to send to the worker (MessagePort, etc)
     * @returns {boolean|string} false if no remotes, otherwise the remote key it was sent to
     */
    postRemoteMessage(data, transferable = undefined) {
        if (!this.hasRemotes()) {
            return false;
        }
        const key = this.getNextRemoteKey();
        if (!this.sendMessageToRemote(key, data, transferable)) {
            return false;
        }
        return key;
    }

    /**
     * Register a promise callback
     * @param {String} callbackId The callback id
     * @returns {Promise}
     */
    registerCallbackId(callbackId) {
        let resolve, reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        promise.resolve = resolve;
        promise.reject = reject;
        this.callbacks[callbackId] = promise;
        return promise;
    }

    /**
     * Receive the results from a command call to a remote thread
     * @param {MessageEvent} evt The event data from the command
     * @returns {void}
     */
    receiveCommandResult(evt) {
        const returnId = evt.data.returnId;
        if (returnId in this.callbacks) {
            const callback = this.callbacks[returnId];
            this.callbacks[returnId] = null;
            delete this.callbacks[returnId];
            if (evt.data.error) {
                callback.reject(evt.data.error);
            } else {
                callback.resolve(evt.data.data);
            }
        }
    }

    /**
     * Create a new message event to manually send to event listeners
     * @param {Object} data The data payload
     * @param {String} [type] The type of event (typically this value is just 'message')
     * @param {Object} [init] Other init data to add with the event
     * @returns {MessageEvent}
     */
    createMessageEvent(data, type = 'message', init = {}) {
        init.data = data;
        return new MessageEvent(type, init);
    }
};