import { Graph, PeerId } from 'p2p-mesh-lib'
import { Edge } from 'p2p-mesh-lib/dist/proto/p2p.gen'

export function between(min: number, max: number) {
  return Math.floor(Math.random() * (max - min) + min)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encode(s: string): Uint8Array {
  return encoder.encode(s)
}

export function decode(data: Uint8Array): string {
  return decoder.decode(data)
}

export function asDot(graph: Graph, nodesToPaint: PeerId[]): string {
  const { peers, matrix, maxPeers } = graph
  const mst: Edge[] = graph.getMST()

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

export function asMatrixHTMLTable(graph: Graph) {
  const { peers, maxPeers, matrix } = graph
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
