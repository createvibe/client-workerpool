/*
 * This file is part of the client-workerpool module.
 * 
 * (c) Anthony Matarazzo <email@anthonymatarazzo.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

// local libs
import { getUniqueId } from './RemoteWorker';

/**
 * ListenerAwareMixin provides a public interface to add, remove, and execute 
 * message listeners.
 *
 * @param {Function} superclass The super class you want to extend
 */
export const ListenerAwareMixin = superclass => class ListenerAwareMixin extends (superclass || class { }) {

    /**
     *
     * @constructor
     */
    constructor() {
        super(...arguments);
        this.listeners = {};
    }

    /**
     * Add a message listener to this worker
     * @param {Function} fn
     * @returns {String} the index for the listener to be removed
     * @throws TypeError on invalid argument
     */
    addMessageListener(fn) {
        if (typeof fn !== 'function') {
            throw new TypeError('Message listener must be a function');
        }
        const idx = getUniqueId();
        this.listeners[idx] = fn;
        return idx;
    }

    /**
     * Remove a message listener by id
     * @param {String} idx The listener id
     * @returns {boolean}
     */
    removeMessageListener(idx) {
        if (idx in this.listeners) {
            this.listeners[idx] = null;
            delete this.listeners[idx];
            return true;
        }
        return false;
    }

    /**
     * Execute message listeners for an event
     * @param {MessageEvent} evt The event
     * @returns {void}
     */
    executeMessageListeners(evt) {
        for (const idx in this.listeners) {
            const listener = this.listeners[idx];
            listener.call(listener, evt);
        }
    }
};