# Pressd — the whole plan

Build, ship, launch, and where the money is. Written so I can hold myself to it.

The idea and the forty it beat are in [IDEAS.md](IDEAS.md).

---

## 0. The bet, in one paragraph

People pay real money for risograph prints, screenprints and cyanotypes. The
software to make them is either a subscription or a pile of Photoshop actions
you need to already know how to use. Nobody has made the fast, free, obvious
version that works on a phone in ten seconds. Pressd is that. It costs nothing
to run because there's no server, and the thing it produces is a poster, and
posters get posted. That's the whole engine.

**One-liner:** Drop a photo. Get art.

**Who it's for, in order:**

1. People who want one nice thing to print and put on a wall.
2. Designers and illustrators who want a riso mockup without booking a press.
3. Musicians and small labels who need cover art tonight.
4. Everyone who just likes pressing buttons and watching their dog turn into a
   1989 handheld screen.

---

## Stage 1 — Build (done, v1.0.0)

Shipped, tagged, live. What went in:

| Piece | What it is | State |
|---|---|---|
| Print engine | 10 engines: riso, halftone, duotone, dither, diffusion, screenprint, engraving, cyanotype, contour, ASCII | done |
| Ink separation | Tone stacking + subtractive colour separation with grey component replacement | done |
| Overprinting | Multiply and screen blends, so two inks make a real third colour | done |
| Auto-levels | Stretches the photo's range first, so dark snaps don't screen to black | done |
| Paper | Fibre, cloudy mottle, grain, vignette, torn deckle edge | done |
| Layouts | 6 layouts, 6 paper sizes, full typesetting with tracking and wrapping | done |
| Styles | 16 presets built on real Risograph and process ink colours | done |
| UI | Drop / paste / browse, live style picker, fine-tune panel, editable inks | done |
| Export | PNG or JPG up to 4000px, resolution-independent | done |
| Privacy | No server, no upload, no analytics. Works offline after load | done |
| Sample art | 4 photos drawn procedurally, so there's no stock licence to worry about | done |

**Rules I held to:**

- No dependencies. No build step. A folder of files a CDN can serve.
- Anything spatial scales off the artwork width, so preview and print match.
- First paint is a finished poster, never an empty box.

### The hard part, and what fixed it

Three real bugs, all found by rendering every style against every sample at
once (`tools/contact-sheet.html`) instead of eyeballing one at a time:

1. **Everything came out solid yellow.** The colour separation was greedy: the
   palest ink claimed a channel, which then blocked every ink after it, so one
   drum won the whole picture. Fixed by pulling the neutral out with the darkest
   ink first — grey component replacement, which is exactly what real printers
   do and for exactly this reason.
2. **Riso solids were flat slabs.** The stochastic screen only fired where
   coverage crossed a threshold, so grain appeared in the gradients and nowhere
   else. Rewrote it as a proper coin-flip-per-grain screen weighted by coverage.
3. **The canvas inflated itself.** The poster's intrinsic size grew the grid
   row, which was then measured to size the poster. The two chased each other
   bigger on every repaint, and worse on high-DPI screens. Fixed by pinning the
   grid row and measuring before touching the canvas.

None of these were visible from a single screenshot. Build the contact sheet
early.

---

## Stage 2 — Ship (done)

- [x] Static site, no build step
- [x] GitHub Pages workflow, deploys the folder as-is on every push
- [x] Open Graph and Twitter cards, so links unfurl with real artwork
- [x] Favicon, meta description, canonical URL
- [x] Responsive down to 390px
- [x] Keyboard reachable, `prefers-reduced-motion` respected
- [x] Released as v1.0.0

**One manual step left before it's live.** Pages has to be switched on by hand
the first time — *Settings → Pages → Source: GitHub Actions* — because a
workflow token isn't allowed to create the Pages site. Once that's done, re-run
the workflow and it deploys on its own from then on.

**Will be live at:** https://rootium.github.io/Placeholder/

---

## Stage 3 — Before telling anyone (the week after)

Small, cheap, high-leverage. In priority order:

1. **Watch five people use it.** Not feedback — watching. Where does the cursor
   stall? Anything they hesitate over for more than three seconds gets changed.
2. **Real photos.** Every sample here is procedural. Test against faces, food,
   pets, screenshots, dark bar photos. The engine defaults will need a nudge.
3. **Phone testing.** A real iPhone and a real cheap Android. A 4000px export is
   64 million pixels of maths; find where it falls over and cap it there.
4. **A share card.** Right now you download a file. Add "copy image" so it goes
   straight into a post. This is the growth loop — it deserves a real button.
5. **A tiny watermark, off by default.** A small "pressd" in the corner that
   users can switch **on** because it looks like a print stamp. Attribution
   people opt into beats attribution you force.

---

## Stage 4 — Launch

The output is the advert. Every post leads with a poster, never a screenshot of
a UI.

### Order of operations

**Day 1 — the places that like a demo**

- **Hacker News**, "Show HN: Pressd – turn a photo into a riso print, no server,
  no sign-up". Lead with the engineering: grey component replacement, real
  overprinting, no upload. That crowd rewards the how, not the what.
- **r/webdev** and **r/SideProject**, same angle.
- Post at 8am Eastern on a Tuesday, Wednesday or Thursday. Then sit in the
  comments all day. Replying beats posting.

**Day 2–7 — the places that like the pictures**

- **r/RISO**, **r/printmaking**, **r/graphic_design**, **r/Design** — read each
  one's rules first, and post work, not links. Answer "how did you make this" in
  the comments.
- **Instagram and Pinterest**: posters only. Pinterest is slow and then it
  isn't; poster images are exactly what it indexes.
- **TikTok / Reels**: fifteen seconds, drag a photo in, cycle the styles, save
  it. No voiceover, no face. The screen recording *is* the content.

**Week 2–4 — the slow stuff that compounds**

- **SEO.** Real pages for real searches: "risograph effect online", "halftone
  generator", "make a cyanotype from a photo", "poster maker free". Each is a
  page that explains the technique properly and drops you into the app with that
  style already loaded.
- **Product Hunt**, once there's a week of feedback baked in. Not before.
- **Email five riso studios.** Not a pitch — a free mockup tool their customers
  can use before ordering a print. They have the exact audience and no reason to
  say no.

### What I'll actually measure

No analytics script, so this stays honest and coarse:

- GitHub stars and traffic (Pages gives referrers)
- Comment threads: which style gets named most
- Where the links get posted next, without me

**Realistic first month:** 5–15k visitors, most from one good HN or Reddit day,
then a long tail from search. Anything past that is luck, and luck needs a
loaded gun.

### What would make it fail

- **Posting a screenshot instead of a poster.** Nobody shares a UI.
- **Launching everywhere in one day.** One channel, all day, in the comments.
- **A slow first paint.** If the first render isn't instant on a mid phone,
  none of the rest matters.

---

## Stage 5 — Money

Not in v1. v1 exists to prove people want it. But the road is real, and it's in
this order:

1. **Print on demand.** The strongest one by far. You've already made the
   artwork; a "have it printed and framed, £39" button is one integration away.
   Take a cut per order. The user is *already holding a print-ready file* — no
   other product gets a customer that warm.
2. **Pro pack, one-time payment.** Extra styles, custom fonts, batch export,
   your own saved ink sets. One price, no subscription. The free version stays
   genuinely complete; that's what keeps the loop running.
3. **Licensing the engine.** It's a dependency-free ES module that does real
   print separation. Print shops and photo apps would pay for that.
4. **Never:** ads, watermarks you have to pay to remove, or an account wall.
   Each one directly damages the sharing loop, which is the only reason this
   works.

---

## Stage 6 — What's next in the product

Ordered by (how much people ask) ÷ (how hard it is):

| Next | Why |
|---|---|
| Copy to clipboard | Removes the last step between making and sharing |
| Print-on-demand button | The money |
| Batch export | One photo, all sixteen styles, as a zip |
| Custom fonts | Most-requested thing in any poster tool, always |
| Palette from an image | Pull ink colours out of a photo you like |
| Web worker rendering | Keeps huge exports off the main thread |
| Save and share a look | A URL that carries your settings |
| More paper stocks | Kraft, black card, newsprint yellow |

---

## The honest risks

- **One-visit product.** Someone makes one poster and never returns. Fought with
  breadth — 16 styles × 6 layouts × 6 sizes — but it's the real threat. The
  answer is print-on-demand: a reason to come back with a *second* photo.
- **Big exports are heavy.** 4000px of per-pixel maths in JavaScript is genuinely
  a lot. Currently handled by previewing small and rendering large only on
  download. Workers next.
- **Someone clones it.** It's MIT and it's client-side, so of course they can.
  The defence isn't the code, it's being the one that's actually good, plus the
  print pipeline, which is a business rather than a file.
- **The taste problem.** Every one of these styles can look cheap if the numbers
  are wrong. That's the real moat and it's the thing to keep grinding.

---

## Where it stands

v1.0.0 is done and live. Sixteen styles, six layouts, six sizes, print-resolution
export, no server, no sign-up, no tracking.

Next up is Stage 3: watch five people use it, then fix whatever makes them
hesitate.
