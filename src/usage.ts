export const USAGE = `glade — a browser for coding agents: drive the app, take pictures a reviewer can use, record a demo

  glade open <url|path>       go to a page (a full URL the first time; then paths resolve against it)
  glade snapshot              what is on the page that you can act on, each with a ref like e12
  glade text [selector]       the page's visible text (or one element's)
  glade click <target>        target: a ref (e12), text=Exact label, a CSS selector, or x,y in page pixels (a canvas)
  glade dblclick <target> | rightclick <target> | hover <target>
  glade drag <from> <to>      press at one target, carry to the other, let go (targets as for click)
  glade scroll <down|up|left|right> [px] [at <target>]   or: scroll to <target>
  glade fill <target> <text>  click the field and type over what's in it, key by key
  glade type <text>           into whatever has focus (a canvas, an editor)
  glade press <key>           Enter, Escape, Tab, ArrowDown…, a character, or cmd+a, shift+Tab, ctrl+Enter
  glade select <target> <option> · check <target> · uncheck <target> · upload <target> <file…>
  glade get text|value|attr <name>|count|box <target> · is visible|enabled|checked <target>
  glade wait <ms|text>        a pause, or until that text is on the page (10s at most)
  glade url · back · reload · console [--clear] · eval <js>
  glade size [phone|tablet|laptop|desktop|wide|WxH]       the viewport (1280×800 to start; held once set)

  glade screenshot [target|x,y,w,h] [--crop] [--full]     prints a PNG path. With a target: the page with it glowing;
                              --crop for just the element; --full for the whole page, however long
  glade highlight <target>    a glowing box around an element, in screenshots and recordings; highlight off ends it
  glade frame <shot.png> [after.png …] --title "what it shows" [--captions "Before|After"] [--out f.png] [--side|--stack]
                              one PNG, framed for a pull request: one picture, a before/after pair, or numbered steps

  glade record start          start recording a demo: every change the page paints, from now
  glade record caption <text> a line along the bottom of the video until the next caption (or caption off)
  glade record stop           assemble the recording into an MP4 and print its path

  glade status · close        is glade up for this project; close its browser (it closes itself after 30 minutes idle)

Pictures and videos go in <project>/tmp/glade. Needs a Chrome (or GLADE_CHROME=…) and, for video, ffmpeg.`
