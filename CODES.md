# Secret outcome codes

Open `/<code>` (e.g. `eightball.lol/c3`) or `/#<code>`. Every throw (or phone shake) on that link lands on
the chosen answer; the die still tumbles and floats up normally. "⌂ Home" (top-left) returns to random mode.
Path links (`/c3`) rely on the fallback to `index.html` (set up in `render.yaml` and `server.py`);
hash links (`/#c3`) work on any static host.

| Code | Answer |
|------|--------|
| c3 | It is certain |
| d5 | It is decidedly so |
| a7 | Without a doubt |
| e9 | Yes definitely |
| b2 | You may rely on it |
| 4f | As I see it, yes |
| 6d | Most likely |
| 1b | Outlook good |
| f0 | Yes |
| 8e | Signs point to yes |
| 2c | Reply hazy, try again |
| 5a | Ask again later |
| 9d | Better not tell you now |
| 7b | Cannot predict now |
| 3e | Concentrate and ask again |
| e4 | Don't count on it |
| 0d | My reply is no |
| b8 | My sources say no |
| f6 | Outlook not so good |
| 61 | Very doubtful |

## Custom messages

Open `eightball.lol/make` (or `/#make`), type a message (up to 60 characters), and copy the link. It looks like
`/#m.V2lsbCB5b3UgbWFycnkgbWU_`: the message is base64url-encoded so it isn't readable in the URL.
Whoever opens it throws the ball as usual, and the die floats up with your words carved into it.
Long messages wrap automatically; press Enter in the box to choose your own line breaks.
