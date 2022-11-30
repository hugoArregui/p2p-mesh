import logo from './logo.svg';
import './App.css';
import { PeerToPeerAdapter,  createServerConnection } from 'p2p-mesh-lib'
import React from 'react';

function App() {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  let adapter
  let messageId = 0

  const [state, setState] = React.useState({ messages: [], room: 'default', serverURL: 'ws://127.0.0.1:6000/service'});

  function onServerURLChange(e) {
    setState({
      ...state,
      serverURL: e.target.value
    })
  }

  function onRoomChange(e) {
    setState({
      ...state,
      room: e.target.value
    })
  }

  function onInputChange(e) {
    setState({
      ...state,
      input: e.target.value
    })
  }

  async function connect() {
    const conn = await createServerConnection({url: state.serverURL, prefix: state.room})
    adapter = new PeerToPeerAdapter(console, conn, {
      maxPeers: 100,
      targetConnections: 4,
      maxConnections: 6,
      fallbackEnabled: false,
      publishStatusIntervalMs: 1000
    })
    adapter.events.on('message', ({ peerId, data }) => {
      setState((state) => {
        const messages = [...state.messages, { messageId: messageId++, sender: peerId, message: decoder.decode(data) }]
        return {...state, messages}
      })
    })
    await adapter.connect()

    function updateAdapterState() {
      setState((state) => ({...state, adapter, matrix: adapter.graph.matrix, peers: adapter.graph.peers, peerId: conn.id}))
    }
    setInterval(updateAdapterState, 100)
    updateAdapterState()
  }

  async function send() {
    const { input } = state
    if (input) {
      state.adapter.send(encoder.encode(input))
    }
  }


  let body

  if (state.adapter) {
    const { peers, matrix } = state

    const table = (
      <table style={{marginLeft:"auto",marginRight:"auto"}}>
        <thead>
          <tr>
            <th key="name"></th>
            {peers.map((peer) => (<th key={`h:${peer}`}>{peer}</th>))}
          </tr>
        </thead>
        <tbody>
          {
            peers.map((peer1, u) => {
              return (
                <tr key={u}>
                  <th>{peer1}</th>
                  {
                    peers.map((peer2, j) =>
                      (<td key={`${peer1},${peer2}`}>{matrix[u * 100 + j]}</td>))
                  }
                </tr>)
            })
          }
        </tbody>
      </table>)


    const messages = state.messages
      .map((item) => `${item.sender}: ${item.message}`).join("\n")
    const messagesStyle = {
      width: "949px",
       height: "278px"
    }
    
    body = (<div>
              <h1>Room: {state.room}</h1>
              <h2>id: {state.peerId}</h2>
              <p>Adjacency table:</p>
              {table}
              <p/>
              <textarea readOnly={true} width="500px" value={messages} style={messagesStyle}></textarea>
              <p>
                <input type="string" onChange={(value) => onInputChange(value)}/>
                <button className="square" onClick={() => send()}>Send</button>
              </p>
            </div>)
  } else {
      body = (<div>
                <p>Server: <input type="string" onChange={(value) => onServerURLChange(value)} /></p>
                <p>Room: <input type="string" defaultValue="default" onChange={(value) => onRoomChange(value)}/></p>
                <button className="square" onClick={() => connect()}>Connect</button>
              </div>)
  }

  return (
    <div className="App">
      {body}
    </div>
  );
}

export default App;
