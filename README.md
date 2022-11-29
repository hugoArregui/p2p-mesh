This project is a PoC for building a P2P mesh with focus in the browser, using webrtc connections. Authors: @agusaldasoro @hugoArregui

The concept is simple:

- Extend the use of a webrtc signaling server in order to perform peer discovery and mesh status updates.
- Peers will discover each other using the mesh status updates, and will connect randomly to each other. Using the mesh knowledge they obtain from the updates, each peer will maintain a view of the mesh in the form of an adjacency matrix. To broadcast a message, peers will take the graph described by the adjacency and calculate the minimum spanning tree (MST) using Prism Algorithm (that is: a tree starting from the current peer and describing the path to every other peer in the mesh, reaching every other peer only once). Then, a package will be send using the path described by the MST, including both the payload and the route to follow. The peers receiving the message will relay the message, if necessary, according to the packet's own rules.


# Project structure

- `lib/`: this is the P2P mesh library that runs in the peer
- `server/`: the server implementation
- `simulation/`: this is an example using the P2P mesh library

# See it on action: running the simulation

```
make install
make build
```

Start the server:

```
cd server
npm run start
```

Start some clients:

```
cd simulation
bin/spawn.sh
```

open localhost:8000 in your browser, there every client will have a link to see their adjacency matrix, their connection status and so on, it's also possible to view a graph like this:

![Graph](/docs/graph.svg)

Showing a picture of how peers are connected, and mark in red, the MST paths.

# Open questions

- Security: the server will share the mesh updates, so the server must be trusted to relay the information in a reliable way. Otherwise the security must be built-in using in the application protocol, by using encryption for example.
- Network partitions: since each peer picks its connections at random, is possible (although very unlikely), to end up in a network partition in which a group of peers are isolated from another group. Since we are able to detect this case, we use the server as a fallback mechanism. Other strategies are possible, like explicitly trying to connect to them, but they are out of the scope of this PoC.
- Amount of connections: each peer will attempt to connect to the number of `targetConnections`, but will accept `maxConnections`. This values varies according to different use cases, since the browsers will not handle a big number of connections, so it's important to reach a balance between what the browser can handle, and an effective amount. Having more connections means the communication will be faster in the mesh, and the MST will be shorter. 

