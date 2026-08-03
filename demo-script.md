# Demo Script (~65–75 seconds)

Stage directions in brackets. Read the rest as narration.

---

**[Baseline view on screen, nobody's clicked anything yet]**

"Here's ColdRelief-500 distribution, live. LA's central warehouse ships to three hubs — Ohio, Texas, and New Jersey — all on rail today, our default low-cost mode."

**[Click "Fire Trigger"]**

"Now — a flu outbreak hits Ohio. This is LaserData pushing a real-time event into the pipeline: demand at Ohio just spiked 3.2 times normal."

**[Ohio node turns red, comparison table appears]**

"Ohio lights up immediately, and the system starts evaluating what to do about it."

**[Click "Simulate Agents" — or pause if teammates' live output is already streaming in]**

"First, the Risk Agent: it checks current stock against the new demand curve and flags that Ohio runs out in under two days."

**[Log line appears: Risk Agent]**

"Next, the Mode Agent weighs rail against truck against air — cost versus speed — and decides rail is too slow to beat the stockout window. It recommends truck."

**[Table highlights the truck row]**

"Finally, RocketRide takes that decision and executes it — dispatching the truck and confirming a new ETA, in real time."

**[Log line appears: RocketRide confirmation, LA→Ohio line switches to truck styling]**

"So end to end: a live signal, three autonomous agents reasoning about risk and logistics, and a real dispatch action — all inside a few seconds, no human in the loop."

**[Optional close, if time allows]**

"And this isn't hardcoded — every panel you just saw is driven by live JSON events, so any of our three services can plug straight in."

---

**Timing note:** the narration alone runs ~65–70 seconds at a natural pace; the bracketed pauses for clicks add the rest. If you're running long, cut the optional close line.
