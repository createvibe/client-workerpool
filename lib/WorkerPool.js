/*
 * This file is part of the client-workerpool module.
 * 
 * (c) Anthony Matarazzo <email@anthonymatarazzo.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

// local libs
import { RemoteWorker } from './RemoteWorker';
import { RemoteAwareMixin } from './RemoteAwareMixin';
import { ListenerAwareMixin } from './ListenerAwareMixin';

/**
 * The worker cluster spawns and maintains a cluster of remote workers and balances the message
 * delivery between them
 */
export class WorkerCluster extends RemoteAwareMixin(ListenerAwareMixin()) {
    /**
     *
     * @param {String|Worker} which The worker script URL or the worker class to instantiate (for webpack support)
     * @param {Number} [numWorkers] The number of workers to spawn (defaults to 3)
     */
    constructor(which, numWorkers = 3) {
        super();
        this.id = this.MASTER_THREAD;
        this.httpAuthorization = null;
        this.httpAccessToken = null;
        this.which = which;
        this.spawn(numWorkers);
    }

    /**
     * Spawn a new worker
     * @param {Number} [numWorkers] The number of workers to spawn (always spawns 1 regardless of 0 value)
     * @returns {void}
     */
    spawn(numWorkers = 1) {
        this.registerRemoteThread(
            this.initializeWorker(
                new RemoteWorker(this.which)));

        // continue until we have spawned all workers
        numWorkers -= 1;
        if (numWorkers > 0) {
            this.spawn(numWorkers);
        }
    }

    /**
     * Initialize a new remote worker before adding it to the cluster
     * @param {RemoteWorker} worker The worker to initialize
     * @returns {RemoteWorker}
     */
    initializeWorker(worker) {
        worker.addMessageListener(evt => this.messageListener(evt));

        if (this.httpAuthorization) {
            worker.postMessage({setHttpAuthorization: this.httpAuthorization});
        }

        if (this.httpAccessToken) {
            worker.postMessage({setHttpAccessToken: this.httpAccessToken});
        }

        return worker;
    }

    /**
     * Register a new remote thread
     * @param {RemoteWorker} worker The remote worker to register as a new thread
     * @returns {void}
     */
    registerRemoteThread(worker) {
        for (const id in this.remotes) {
            const remote = this.remotes[id];
            remote.registerRemoteThread(worker);
            worker.registerRemoteThread(remote);
        }
        this.remotes[worker.id] = worker;
    }

    /**
     * Recieve a message from a worker
     * @param {MessageEvent} evt The event
     * @returns {void}
     */
    messageListener(evt) {
        if (evt.data.returnId) {
            this.receiveCommandResult(evt);
            return;
        }
        this.executeMessageListeners(evt);
    }

    /**
     * Terminate a worker or all workers
     * @param {String} [id] The id of the worker to terminate, if not given all are terminated
     * @returns {void}
     */
    terminate(id = null) {
        if (!id) {
            for (const id in this.remotes) {
                this.terminate(id);
            }
            return;
        }
        if (id in this.remotes) {
            this.remotes[id].terminate();
            this.remotes[id] = null;
            delete this.remotes[id];
            this.broadcast({remote: id, terminate: true});
        }
    }

    /**
     * Post a message to the worker
     * @param {*} data The data to send to the worker
     * @param {Object[]} [transferrable] Transferrable objects to send to the worker (MessagePort, etc)
     * @returns {false|String} false or the remote thread key the message went to
     */
    postMessage(data, transferrable = undefined) {
        return this.postRemoteMessage(data, transferrable);
    }

    /**
     * Send a command to a remote worker in the cluster
     * @param {String} name The command name
     * @param {Array} [args] Arguments to send to the command
     * @returns {Promise}
     */
    sendCommand(name, args = []) {
        const callbackId = RemoteWorker.getUniqueId();
        const promise = this.registerCallbackId(callbackId);
        const sent = this.postMessage({
            cmd: name,
            args,
            callbackId
        });
        if (!sent) {
            promise.reject(new Error('Unable to send command: ' + command));
        }
        return promise;
    }

    /**
     * Set the HTTP Authorization to user for HTTP requests
     * @param {String} auth HTTP Basic Authentication hash
     * @returns {void}
     */
    setHttpAuthorization(auth) {
        this.httpAuthorization = auth;
        this.broadcast({setHttpAuthorization: auth});
    }

    /**
     * Set the HTTP X-Access-Token header value for HTTP requests
     * @param {String} accessToken The HTTP access token
     * @returns {void}
     */
    setHttpAccessToken(accessToken) {
        this.httpAccessToken = accessToken;
        this.broadcast({setHttpAccessToken: accessToken});
    }
}