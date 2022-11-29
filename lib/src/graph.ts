import { Edge } from './proto/p2p.gen'
import { PeerId } from './types'

export type Graph = {
  addConnection: (p1: PeerId, p2: PeerId) => void
  removeConnection: (p1: PeerId, p2: PeerId) => void
  removePeer: (p: PeerId) => void
  getMST: () => Edge[]
  getReachablePeers: () => Set<PeerId>
  isConnectedTo: (peerId: PeerId) => number

  asDot: (nodesToPaint: PeerId[]) => string
  asMatrixHTMLTable: () => string
}

export function createConnectionsGraph(peerId: PeerId, maxPeers: number): Graph {
  const peers: PeerId[] = [peerId]
  const matrix = new Uint8Array(maxPeers * maxPeers)
  matrix.fill(0)

  let mst: Edge[] = []
  let dirty = true
  const reachablePeers = new Set<PeerId>()

  function isConnectedTo(peerId: PeerId): number {
    let v = peers.indexOf(peerId)
    if (v === -1) {
      return -1
    }
    return matrix[v]
  }

  function getMST() {
    if (dirty) {
      calculate()
      dirty = false
    }
    return mst
  }

  function getReachablePeers(): Set<PeerId> {
    if (dirty) {
      calculate()
      dirty = false
    }
    return reachablePeers
  }

  function addConnection(p1: PeerId, p2: PeerId): void {
    let u = peers.indexOf(p1)
    if (u === -1) {
      dirty = true
      u = peers.length
      peers.push(p1)
    }

    let v = peers.indexOf(p2)
    if (v === -1) {
      dirty = true
      v = peers.length
      peers.push(p2)
    }

    if (!dirty) {
      dirty = matrix[u * maxPeers + v] !== 1
    }

    matrix[u * maxPeers + v] = 1
    matrix[v * maxPeers + u] = 1
  }

  function removeConnection(p1: PeerId, p2: PeerId): void {
    const u = peers.indexOf(p1)
    const v = peers.indexOf(p2)

    if (u === -1 || v === -1) {
      return
    }

    if (!dirty) {
      dirty = matrix[u * maxPeers + v] !== 0
    }

    matrix[u * maxPeers + v] = 0
    matrix[v * maxPeers + u] = 0
  }

  function removePeer(p: PeerId): void {
    const deletedPeerIndex = peers.indexOf(p)
    if (deletedPeerIndex === -1) {
      return
    }

    dirty = true
    const lastPeerIndex = peers.length - 1

    if (deletedPeerIndex !== lastPeerIndex) {
      // if the peer to delete is not the last one, move it to the last
      for (let j = 0; j < maxPeers; j++) {
        matrix[deletedPeerIndex * maxPeers + j] = matrix[lastPeerIndex * maxPeers + j]
      }

      for (let j = 0; j < maxPeers; j++) {
        matrix[j * maxPeers + deletedPeerIndex] = matrix[j * maxPeers + lastPeerIndex]
      }

      peers[deletedPeerIndex] = peers[lastPeerIndex]
    }

    // always fill the removed element (the last) with zeros in the matrix
    for (let j = 0; j < maxPeers; j++) {
      matrix[lastPeerIndex * maxPeers + j] = 0
      matrix[j * maxPeers + lastPeerIndex] = 0
    }

    peers.pop()
  }

  // primMST
  function calculate() {
    // A utility function to find the vertex with
    // minimum key value, from the set of vertices
    // not yet included in MST
    function minKey(key: number[], mstSet: boolean[]): number {
      // Initialize min value
      let min = Number.MAX_VALUE
      let min_index: number = 0

      for (let v = 0; v < peers.length; v++) {
        if (mstSet[v] === false && key[v] < min) {
          min = key[v]
          min_index = v
        }
      }

      return min_index
    }

    // Array to store constructed MST
    const parent: number[] = []

    // Key values used to pick minimum weight edge in cut
    const key: number[] = []

    // To represent set of vertices included in MST
    const mstSet: boolean[] = []

    // Initialize all keys as INFINITE
    for (let i = 0; i < peers.length; i++) {
      key[i] = Number.MAX_VALUE
      mstSet[i] = false
    }

    // Always include first 1st vertex in MST.
    // Make key 0 so that this vertex is picked as first vertex.
    key[0] = 0
    parent[0] = -1 // First node is always root of MST

    // The MST will have V vertices
    for (let count = 0; count < peers.length - 1; count++) {
      // Pick the minimum key vertex from the
      // set of vertices not yet included in MST
      const u = minKey(key, mstSet)

      // Add the picked vertex to the MST Set
      mstSet[u] = true

      // Update key value and parent index of
      // the adjacent vertices of the picked vertex.
      // Consider only those vertices which are not
      // yet included in MST
      for (let v = 0; v < peers.length; v++)
        // matrix[u][v] is non zero only for adjacent vertices of m
        // mstSet[v] is false for vertices not yet included in MST
        // Update the key only if matrix[u][v] is smaller than key[v]
        if (matrix[u * maxPeers + v] && mstSet[v] === false && matrix[u * maxPeers + v] < key[v]) {
          parent[v] = u
          key[v] = matrix[u * maxPeers + v]
        }
    }

    reachablePeers.clear()
    const mstEdges: Edge[] = []
    for (let i = 1; i < peers.length; i++) {
      if (parent[i] !== undefined) {
        const u = peers[parent[i]]
        const v = peers[i]
        reachablePeers.add(u)
        reachablePeers.add(v)
        mstEdges.push({ u, v })
      }
    }
    mst = mstEdges
  }

  function asDot(nodesToPaint: PeerId[]): string {
    const mst: Edge[] = getMST()

    const dot: string[] = []

    dot.push('graph {')
    for (let u = 0; u < peers.length; u++) {
      const node = peers[u]
      if (nodesToPaint.includes(node)) {
        dot.push(`"${node}" [style=filled,fillcolor=green]`)
      } else {
        dot.push(`"${node}"`)
      }
    }

    for (let u = 0; u < peers.length; u++) {
      for (let v = u; v < peers.length; v++) {
        if (matrix[u * maxPeers + v]) {
          if (
            mst.find(({ u: _u, v: _v }) => (_u === peers[u] && _v === peers[v]) || (_v === peers[u] && _u === peers[v]))
          ) {
            dot.push(`"${peers[u]}" -- "${peers[v]}" [color=red]`)
          } else {
            dot.push(`"${peers[u]}" -- "${peers[v]}"`)
          }
        }
      }
    }
    dot.push('}')
    return dot.join('\n')
  }

  function asMatrixHTMLTable() {
    let s = '<table>'
    s += '<tr><th></th>'
    for (let u = 0; u < peers.length; u++) {
      s += `<th>${peers[u]}</th>`
    }
    s += '</tr>'

    s += '<tr>'
    for (let u = 0; u < peers.length; u++) {
      s += `<th onclick="toggle(this)">${peers[u]}</th>`
      for (let j = 0; j < peers.length; j++) {
        const r = matrix[u * maxPeers + j] ? '1' : '0'
        s += `<td>${r}</td>`
      }
      s += '</tr>'
    }
    s += '</table>'

    return `
<html>
<head>
<style>
th, td {
  width: 20px;
  text-align: right;
}

table, th, td {
  border: 1px solid black;
  border-collapse: collapse;
}

tr:nth-child(even) {
  background-color: rgba(150, 212, 212, 0.4);
}

th:nth-child(even),td:nth-child(even) {
  background-color: rgba(150, 212, 212, 0.4);
}
</style>
<script>
function toggle(e) {
e.parentElement.style.background = e.parentElement.style.background === "red" ? "" : "red"
}

</script>
</head>
<body>
${s}
</body>
</html>
`
  }

  return {
    addConnection,
    removeConnection,
    removePeer,
    getMST,
    getReachablePeers,
    asDot,
    asMatrixHTMLTable,
    isConnectedTo
  }
}
