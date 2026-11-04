export const USAGE = `lantern — a browser for coding agents: drive the app, take pictures a reviewer can use, record a demo

  lantern open <url|path>       go to a page (a full URL the first time; then paths resolve against it)
  lantern version               which lantern this is (and whether a newer one is out)
  lantern snapshot              what is on the page that you can act on, each with a ref like e12
  lantern text [selector]       the page's visible text (or one element's)
  lantern click <target>        target: a ref (e12), text=Exact label, a CSS selector, or x,y in viewport pixels (a canvas)
  lantern dblclick <target> | rightclick <target> | hover <target>
  lantern drag <from> <to>      press at one target, carry to the other, let go (targets as for click)
  lantern scroll <down|up|left|right> [px] [at <target>]   or: scroll to <target> · scroll top · scroll bottom
  lantern fill <target> <text>  click the field and type over what's in it, key by key (a date, range or colour input is set directly; "" clears it)
  lantern type <text>           into whatever has focus (a canvas, an editor)
  lantern press <key>           Enter, Escape, Tab, ArrowDown…, a character, or cmd+a, shift+Tab, ctrl+Enter
  lantern select <target> <option…> · check <target> · uncheck <target> · upload <target> <file…>   (several options for a multi-select)
  lantern get text|value|attr <name>|style <property>|count|box <target> · is visible|enabled|checked <target>
  lantern wait <ms|text>        a pause (30s at most), or until that text is on the page (10s at most)
  lantern url · back · reload · console [--clear] · eval <js>
  lantern size [phone|tablet|laptop|desktop|wide|WxH]       the viewport (desktop, 1440×900, to start)

  lantern screenshot [target|x,y,w,h] [--crop] [--full]     prints a PNG path, at 2x. With a target: the page with it glowing;
                              --crop for just the element; --full for the whole page, however long or wide
  lantern highlight <target>    a glowing box around an element, in screenshots and recordings; highlight off ends it
  lantern callout <target> <words>   the words beside the element, joined to it by a line, the element lit; "callout 2 <target> <words>" numbers it; callout off ends it
  lantern badge <n> <target>    a numbered disc on the element's corner: the steps of a still, in order
  lantern ring <target> · arrow <target> · blur <target>   a ring around something small; a bold arrow pointing at it; the element blurred out (a name, a number)
  lantern clear [kind]          every annotation off (or one kind: highlight, callout, badge, ring, arrow, blur); they follow their element and go when it does
  lantern frame <shot.png> [after.png …] --title "what it shows" [--captions "Before|After"] [--note "ABC-123"] [--footer "…"] [--out f.png] [--side|--stack]
                              one PNG, framed for a pull request: one picture, a before/after pair, or numbered steps

  lantern record start [--title "what it shows"] [--note ABC-123] [--footer "…"]   start recording a demo; the video sits in lantern's banner, with the title above when given
  lantern record caption <text> a line along the bottom of the video until the next caption (or caption off)
  lantern record stop           assemble the recording into an MP4 and print its path

  lantern watch               a live view of the page for a person: prints a URL to open in a browser (--open opens it for you)
  lantern status · close      is lantern up for this project; close its browser (it closes itself 30 minutes after the last command)
  lantern update              install the latest lantern now (a global npm install checks once a day and updates itself)
  lantern skills install      link the skills in this package into ~/.claude/skills (and Codex's), so they follow every update

Pictures, videos and downloads go in <project>/tmp/lantern. Needs a Chrome (or LANTERN_CHROME=…); ffmpeg is optional for video.
Settings, in the environment or a .lantern.json at the project root: url (where paths resolve), hosts (the only hosts
the page may visit), out (where pictures go), note and footer (for the frame), accent (the colour of what lantern draws),
watermark (false to drop the banner from videos and "made with lantern" from frames), onLoad (JavaScript to run after each load),
update (false to stop the daily check for a newer lantern), branch (false to keep the branch name out of the footer).`
