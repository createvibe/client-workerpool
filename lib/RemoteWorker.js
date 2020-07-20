/*
 * This file is part of the client-workerpool module.
 * 
 * (c) Anthony Matarazzo <email@anthonymatarazzo.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

// local libs
import { ListenerAwareMixin } from './ListenerAwareMixin';

// fail-safe unique counter
let uniqueId = 0;

/**
 * Generate a unique id
 * @returns {string}
 */
export const getUniqueId = () => ++uniqueId + '.' + (new Date()).getTime() +
    '.' + (performance ? performance.now() : Math.random()) +
    '.' + Math.random();

/**
 * A remote worker is one that accepts incoming messages from other threads via a message channel
 *
 * This is different from a normal worker, becuase normal workers only accept messages from the
 * spawning thread
 *
 * Remote workers have a special ident message that sends the incoming port it needs to bind to.
 * Your worker has to listen for this data payload to be sent first, and bind a message listener to
 * the MessagePort attached to the payload, for incoming messages.
 */
export class RemoteWorker extends ListenerAwareMixin() {
    /**
     * Generate a unique id
     * @returns {string}
     */
    static getUniqueId() {
        return getUniqueId();
    }

    /**
     * Each instance represents one worker in the balanced cluster
     * @param {String|Worker} The worker script URL or the worker class to instantiate (for webpack support)
     * @throws Error for invalid argument
     */
    constructor(which) {

        super();

        // get the worker intance (if-else logic to support webpack's worker-loader)
        if (typeof which === 'string') {
            this.worker = new Worker(which);
        } else if (which instanceof Function) {
            this.worker = new which();
        } else {
            throw new Error('Invalid Argument');
        }

        // initialize empty remote thread (MessageChannel map)
        this.threads = {};

        // generate a unique id
        this.id = getUniqueId();

        this.worker.onmessage = evt => this.messageListener(evt);
        this.worker.onmessageerror = evt => this.errorListener(evt);
        this.worker.onerror = err => this.errorListener(err);

        // identify with our id
        this.postMessage({ident: this.id});
    }

    /**
     * Register a new remote thread
     * @param {RemoteWorker} worker The remote worker to register as a new thread
     * @returns {void}
     * @throws Error on duplicate thread
     */
    registerRemoteThread(worker) {
        if (worker.id in this.threads) {
            throw new Error('Worker thread, ' + worker.id + ', is already registered');
        }

        /* NOTE: two-way channel for this thread to talk to the new thread
                    - this worker receives communication on port 1
                    - other worker communicates with this worker through port 2
                 message channels can only be used by the originating and receiving threads */

        const channel = new MessageChannel();
        channel.port1.start();
        channel.port2.start();
        this.threads[worker.id] = channel;

        // register the new thread id and remote message port with this thread
        worker.postMessage({listen: this.id}, [channel.port1]);
        this.postMessage({remote: worker.id}, [channel.port2]);
    }

    /**
     * Terminate the worker (and remove the iframe)
     * @returns {void}
     */
    terminate() {
        // stop all ports from this thread connecting to any siblings
        for (const thread of this.threads) {
            thread.port1.stop();
            thread.port2.stop();
        }
        // terminate the worker
        if (this.worker) {
            this.worker.terminate();
        }
        // re-init
        this.worker = null;
        this.listeners = {};
        this.threads = {};
    }

    /**
     * Post a message to the worker
     * @param {*} data The data to send to the worker
     * @param {Object[]} [transferrable] Transferrable objects to send to the worker (MessagePort, etc)
     * @returns {void}
     */
    postMessage(data, transferrable = undefined) {
        if (!this.worker) {
            return;
        }
        this.worker.postMessage(data, transferrable);
    }

    /**
     * Receive a message from our attached worker
     * @param {MessageEvent} evt The event
     * @returns {void}
     */
    messageListener(evt) {
        this.executeMessageListeners(evt);
    }

    /**
     * Recieve an error from our attached worker
     * @param {Error|Object} error The error
     * @returns {void}
     */
    errorListener(error) {
        this.executeMessageListeners(
            new MessageEvent('message', {data: {error}}));
    }
}