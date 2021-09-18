client-workerpool
---------------------

This library maintains a pool of workers.

Each worker runs on a separate background thread, on the client device (web browser).

Each worker in the pool communicates with other siblings, using a private two-way MessageChannel. 

Each worker in the pool is loaded from the same JavaScript source, and so they all have the same registered commands. When executing a registered command, a promise is returned.

The communication to sibling threads is load balanced from the perspective of the worker or device sending the message.

# Usage

Two interfaces need to be implemented. One on the device (browser), and one on the background thread (worker).

The device uses the `WorkerPool` to communicate with background threads.  Each background thread uses the `ThreadPool` to register commands and communicate with siblings.

## On The Client Device (Browser)

The client device instantiates a `WorkerPool`, and specifies the number of threads to spawn. Using this object, the client device can communicate with workers in the `ThreadPool`.

```js
/* index.js */

// import the worker pool 
import { WorkerPool } from 'client-workerpool/lib/WorkerPool';

// import your worker (this example uses the worker-loader for webpack)
import MyWorker from 'worker-loader!./my-worker.js';

// start the pool with the default number of threads, and pass your worker class to it
const pool = new WorkerPool(MyWorker, 5);

// execute a command on a worker in the ThreadPool and wait for the response asynchronously
pool.sendCommand('doSomething', ['arg', 'list']).then(data => {
    console.log('got response from workers', data);
}).catch(err => {
    console.error(err.stack);
});
```

## On The Background Thread (Worker)

The worker uses the `ThreadPool` to register and provide business logic for commands recieved from the device.

```js
/* my-worker.js */

// import the thread pool class
import { ThreadPool } from 'client-workerpool/lib/ThreadPool';

// create your thread pool instance, and pass the worker context to it (`self`)
const thread = new ThreadPool(self);

// register commands on this thread
thread.registerCommand('doSomething', (threadId, arg, list) => {

    // threadId is the thread making the request
    // arg, list are the arguments passed to the command
    
    // ask other threads to perform some background tasks for us
    return Promise.all([
        
        thread.sendCommand('doBackgroundStuff', [arg, list]),
        thread.sendCommand('doBackgroundStuff', [arg, list]),
        thread.sendCommand('doBackgroundStuff', [arg, list]),
        thread.sendCommand('doBackgroundStuff', [arg, list])
        
    ]).then(data => { 
        
        // resovle with your final data payload - this gets sent back to the main requesting thread (master)
        return data;
        
    });
    
});

// register the background command here also
thread.registerCommand('doBackgroundStuff', (threadId, arg, list) => {

    const data = [];
    const limit = Math.random() * 1000000;
    for (let i = 0; i < limit; i++) {
        data.push(Math.random() * i);
    }
    
    return data;

});

```

### ThreadPool Public Interface

The `ThreadPool` has a public interface that provides business logic for common commands. 

Be sure to examine all the classes and mixins.

#### HTTP Requests

To make an HTTP request from within a worker pool, use the `ThreadPool.httpRequest` method.

# Installation

`npm install --save client-workerpool`
