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
import { RemoteAwareMixin } from './RemoteAwareMixin';
import { ListenerAwareMixin } from './ListenerAwareMixin';

/**
 * The ThreadPool is used in a worker to receive commands from and communicate with the
 * WorkerPool that spawned it, and the sibling RemoteWorkers in the pool.
 */
export class ThreadPool extends RemoteAwareMixin(ListenerAwareMixin()) {

    /**
     *
     * @param {Object} context The worker context / `self` global object
     */
    constructor(context) {
        super();
        this.id = null;
        this.httpAuth = null;
        this.httpAccessToken = null;
        this.ports = {};
        this.commands = {};
        this.context = context;
        this.context.addEventListener('message', evt => this.messageListener(evt));
    }

    /**
     * Shorthand to get a unique id from the thread instance
     * @returns {String}
     */
    getUniqueId() {
        return getUniqueId();
    }

    /**
     * {@inheritDoc}
     * @see RemoteAwareMixin.postRemoteMessage
     */
    postRemoteMessage(data, transferable = undefined) {
        if (!this.hasRemotes()) {
            // handle the message ourself
            this.messageListener(data); // TODO: will data be the same as the event from postMessage ?
            return;
        }
        return super.postRemoteMessage(...arguments);
    }

    /**
     * {@inheritDoc}
     * @see RemoteAwareMixin.sendMessageToRemote
     */
    sendMessageToRemote(threadId, data = {}, transferable = undefined) {
        if (typeof data === 'object') {
            data.thread = this.id;
        }
        if (this.isMasterThread(threadId)) {
            return this.sendMessageToMaster(data, transferable);
        }
        if (this.isThisThread(threadId) || !this.hasRemotes()) {
            this.messageListener(this.createMessageEvent(data));
            return true;
        }
        return super.sendMessageToRemote(threadId, data, transferable);
    }

    /**
     * Send a message to the main thread that spawned this worker context
     * @param {*} data The data to send
     * @param {Object[]} [transferable] Transferable objects to send to the worker (MessagePort, etc)
     * @returns {boolean}
     */
    sendMessageToMaster(data, transferable = undefined) {
        if (!transferable || transferable.length === 0) {
            data = JSON.parse(JSON.stringify(data));
        }
        //console.log('thread', this.id, 'is sending data to master', ' ----- keys', Object.keys(data), ' ----- data', JSON.stringify(data).substr(0, 150));
        this.context.postMessage(data, transferable);
        return true;
    }

    /**
     * Receive a message from the main thread
     * @param {MessageEvent} evt The event
     * @returns {void}
     */
    messageListener(evt) {
        if (evt && typeof evt.data === 'object') {
            if (evt.data.ident) {
                this.ident(evt);
                return;
            }
            if (evt.data.remote) {
                this.remoteIdent(evt);
                return;
            }
            if (evt.data.listen) {
                this.remotePortIdent(evt);
                return;
            }
            if (evt.data.cmd) {
                this.executeCommand(evt);
                return;
            }
            if (evt.data.returnId) {
                this.receiveCommandResult(evt);
                return;
            }
            if (evt.data.setHttpAccessToken) {
                this.setHttpAccessToken(evt.data.setHttpAccessToken);
                return;
            }
            if (evt.data.setHttpAuth) {
                this.setHttpAuthorization(evt.data.setHttpAuth);
                return;
            }
        }
        this.executeMessageListeners(evt);
    }

    /**
     * Execute a command from a message event
     * @param {MessageEvent} evt The command event object
     * @returns {void}
     */
    executeCommand(evt) {
        const { cmd, args, thread, callbackId } = evt.data;
        if (!(cmd in this.commands)) {
            this.sendMessageToRemote(thread, {
                returnId: callbackId,
                error: new Error('Command not found: ' + cmd)
            });
            return;
        }
        let response = this.commands[cmd].call(null, thread, ...args);
        if (!(response instanceof Promise)) {
            response = Promise.resolve(response);
        }
        response
            //.then(data => { console.log('thread', this.id, 'got response from command', cmd, 'originating from thread', thread, ' ----- ', JSON.stringify(data).substr(0, 150)); return data; })
            .then(([data, transferable]) => this.sendMessageToRemote(thread, { data, returnId: callbackId }, transferable))
            .catch(err => this.sendMessageToRemote(thread, {
                error: err.stack || err.message || JSON.stringify(err),
                returnId: callbackId,
                previousEvent: evt
            }));
    }

    /**
     * Receive identity information about this worker thread (ourselves) from the main thread
     * @param {MessageEvent} evt The event
     * @returns {void}
     */
    ident(evt) {
        this.id = evt.data.ident;
    }

    /**
     * Recieve identity information about other remote workers inside the same cluster
     * @param {MessageEvent} evt The event
     * @returns {void}
     */
    remoteIdent(evt) {
        if (evt.data.terminate) {
            this.remotes[evt.data.remote] = null;
            delete this.remotes[evt.data.remote];
            return;
        }
        this.remotes[evt.data.remote] = evt.ports[0];
        evt.ports[0].start();
    }

    /**
     * Receive an incoming port from another thread
     * @param {MessageEvent} evt The event
     * @returns {void}
     */
    remotePortIdent(evt) {
        const threadId = evt.data.listen;
        this.ports[threadId] = evt.ports[0];
        evt.ports[0].start();
        evt.ports[0].addEventListener('message', e => this.portListener(threadId, e));
        evt.ports[0].addEventListener('error', err => this.errorListener(err));
    }

    /**
     * Receive a message from an external thread
     * @param {String} threadId The originating thead id
     * @param {MessageEvent} evt The event
     * @returns {void}
     */
    portListener(threadId, evt) {
        this.messageListener(evt);
    }

    /**
     * Listen for errors
     * @param {Error|Object} error The error
     * @returns {void}
     */
    errorListener(error) {
        if (error.thread) {
            this.sendMessageToRemote(error.thread, error);
            return;
        }
        this.executeMessageListeners(evt,
            new MessageEvent('message', {data: {error}}));
    }

    /**
     * Register a command for this thread
     * @param {String} name The name of the command
     * @param {Function} fn The function to execute
     * @throws Error on invalid argument
     */
    registerCommand(name, fn) {
        if (typeof fn !== 'function') {
            throw new Error('Not a function');
        }
        this.commands[name] = fn;
    }

    /**
     * Send a command to another remote thread in the cluster
     * @param {String} name The name of the command
     * @param {Array} [args] The arguments to send to the command
     * @param {String} [thread] The thread to send to, if not given, the next remote key is used
     * @returns {Promise}
     * @throws Error on invalid argument
     */
    sendCommand(name, args = [], thread = null) {
        const callbackId = getUniqueId();
        const promise = this.registerCallbackId(callbackId);
        if (!(name in this.commands)) {
            promise.reject(new Error('Invalid Command'));
            return promise;
        }
        if (!this.hasRemotes()) {
            // execute the command locally
            this.executeCommand({
                thread: this.id,
                cmd: name,
                args,
                callbackId
            });
            return promise;
        }
        if (!thread) {
            thread = this.getNextRemoteKey();
        } else if (!(thread in this.remotes)) {
            promise.reject(new Error('Invalid Thread'));
            return promise;
        }
        const sent = this.sendMessageToRemote(thread, {
            cmd: name,
            args,
            thread,
            callbackId
        });
        if (!sent) {
            promise.reject(new Error('Unable to send to thread, ' + thread));
        }
        return promise;
    }

    /**
     * Set the HTTP Authorization to user for HTTP requests
     * @param {String} auth HTTP Basic Authentication hash
     * @returns {void}
     */
    setHttpAuthorization(auth) {
        this.httpAuth = auth;
    }

    /**
     * Set the HTTP X-Access-Token header value for HTTP requests
     * @param {String} accessToken The HTTP access token
     * @returns {void}
     */
    setHttpAccessToken(accessToken) {
        this.httpAccessToken = accessToken;
    }

    /**
     * Make an XHR request (with credentials)
     * @param {String} method The HTTP method (GET, POST)
     * @param {String} url The URL to request
     * @param {*} data Data to send with xhr
     * @param {{}} [headers] Optional request headers
     * @returns {XMLHttpRequest}
     */
    httpRequest(method, url, data, headers = {}) {
        headers = Object.keys(headers).reduce((keys, key) => {
            keys[key.toLowerCase()] = headers[key];
            return keys;
        }, {});
        if (!('content-type' in headers) && method === 'POST') {
            // NOTE: safari doesn't like checking (data instanceof FormData) inside the worker
            if (typeof data === 'object') {
                headers['content-type'] = 'multipart/form-data';
            } else {
                headers['content-type'] = 'application/x-www-form-urlencoded';
            }
        }
        if (!('authorization' in headers) && this.httpAuth) {
            headers['authorization'] = 'Basic ' + this.httpAuth;
        }
        if (!('x-access-token' in headers) && this.httpAccessToken) {
            headers['x-access-token'] = this.httpAccessToken;
        }
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', () => {
            if (xhr.status >= 500 && xhr.status < 600) {
                callback(new Error(xhr.status + ' Resposne'), null);
                return;
            }
            if (xhr.status === 401 || xhr.status === 403) {
                callback(new Error('Access Denied'), null);
                return;
            }
            if (xhr.status === 404) {
                callback(new Error('URL Not Found'), null);
                return;
            }
            let dataStr;
            try {
                dataStr = JSON.parse(xhr.responseText);
            } catch (err) {
                callback(err, null);
            } finally {
                callback(null, dataStr);
            }
        });
        xhr.addEventListener('abort', () => callback(new Error('Request Aborted'), null));
        xhr.addEventListener('error', err => callback(err, null));
        xhr.open(method, url, true);
        for (const [key, value] in Object.entries(headers)) {
            xhr.setRequestHeader(key, value);
        }
        xhr.send(data);
        return xhr;
    }
}
