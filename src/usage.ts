export const USAGE = `lantern — a browser for coding agents: drive the app, take pictures a reviewer can use, record a demo

  lantern open <url|path>       go to a page (a full URL the first time; then paths resolve against it)
  lantern version               which lantern this is
  lantern snapshot              what is on the page that you can act on, each with a ref like e12
  lantern text [selector]       the page's visible text (or one element's)
  lantern click <target>        target: a ref (e12), text=Exact label, a CSS selector, or x,y in page pixels (a canvas)
  lantern dblclick <target> | rightclick <target> | hover <target>
  lantern drag <from> <to>      press at one target, carry to the other, let go (targets as for click)
  lantern scroll <down|up|left|right> [px] [at <target>]   or: scroll to <target>
  lantern fill <target> <text>  click the field and type over what's in it, key by key (a date, range or colour input is set directly)
  lantern type <text>           into whatever has focus (a canvas, an editor)
  lantern press <key>           Enter, Escape, Tab, ArrowDown…, a character, or cmd+a, shift+Tab, ctrl+Enter
  lantern select <target> <option…> · check <target> · uncheck <target> · upload <target> <file…>   (several options for a multi-select)
  lantern get text|value|attr <name>|count|box <target> · is visible|enabled|checked <target>
  lantern wait <ms|text>        a pause (30s at most), or until that text is on the page (10s at most)
  lantern url · back · reload · console [--clear] · eval <js>
  lantern size [phone|tablet|laptop|desktop|wide|WxH]       the viewport (desktop, 1440×900, to start)

  lantern screenshot [target|x,y,w,h] [--crop] [--full]     prints a PNG path, at 2x. With a target: the page with it glowing;
                              --crop for just the element; --full for the whole page, however long or wide
  lantern highlight <target>    a glowing box around an element, in screenshots and recordings; highlight off ends it
  lantern frame <shot.png> [after.png …] --title "what it shows" [--captions "Before|After"] [--note "ABC-123"] [--footer "…"] [--out f.png] [--side|--stack]
                              one PNG, framed for a pull request: one picture, a before/after pair, or numbered steps

  lantern record start          start recording a demo: every change the page paints, from now
  lantern record caption <text> a line along the bottom of the video until the next caption (or caption off)
  lantern record stop           assemble the recording into an MP4 and print its path

  lantern watch               a live view of the page in your own browser (prints a URL and opens it; --no-open to just print)
  lantern status · close      is lantern up for this project; close its browser (it closes itself after 30 minutes idle)

Pictures, videos and downloads go in <project>/tmp/lantern. Needs a Chrome (or LANTERN_CHROME=…); ffmpeg is optional for video.
Settings, in the environment or a .lantern.json at the project root: url (where paths resolve), hosts (the only hosts
the page may visit), out (where pictures go), note and footer (for the frame), accent (the colour of what lantern draws),
watermark (false to drop the "made with lantern" mark from videos), onLoad (JavaScript to run after each load).`
