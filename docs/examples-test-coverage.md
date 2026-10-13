# Example assertion migration

The examples already load deterministic authored positions directly. Retain the
engine-button, asynchronous bot-reply, and puzzle-solution journeys to cover their
integration boundaries; no production fixture seams are needed.

| Previous assertion | Real Chrome AX replacement |
| --- | --- |
| Three landing cards | `example-links.txt` region snapshot contains all three links and their content |
| Analysis link navigates to analysis URL | AX link click plus unchanged URL assertion |
| Analysis renders 64 squares | Count 64 gridcell nodes in Chess board AX snapshot |
| Initial analysis is After Bb5 | Exact StaticText lookup |
| Engine button sets evaluation +0.34 | Exact StaticText lookup after AX button click |
| Engine line renders one arrow | `analysis-engine-line.txt` board snapshot includes exactly its two named endpoints |
| Bot responds with two history entries | Wait for 2 plies then `bot-move-history.txt` region snapshot |
| Bot returns control (Your move) | Exact StaticText lookup |
| White pawn reaches e4 | Exact gridcell role/name lookup |
| Bot enables all squares | Zero disabled gridcells in board AX snapshot |
| Puzzle auto-reply puts black rook on e8 | Exact gridcell role/name lookup |
| Puzzle finishes with Solved — checkmate. | Exact StaticText lookup |
| Solution is Rxe8+, Rxe8, Qxe8# | `puzzle-solution.txt` list snapshot preserves order and text |
| Completed puzzle disables 64 squares | Count 64 disabled gridcells in board AX snapshot |
| Examples have no startup page errors | Auto fixture captures page errors throughout each test |

All square clicks resolve role and accessible name through CDP and act through
backend DOM nodes. Startup readiness uses the rendered AX board instead of
network idle. Screenshot coverage of injected analysis and puzzle boards is
provided by the board state suite.
