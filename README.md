# Universal Paperclips - automated

Universal Paperclips is a 2017 game with uncanny relevance to the ongoing AI renaissance. The game runs at https://decisionproblem.com/paperclips/. There's also a [https://en.wikipedia.org/wiki/Universal_Paperclips](WikiPedia article).

At the surface it's a dumb clicker game, but it tells a compelling story about how ASI might kill all humans, using AI alignment terminology all the way. Also, it's got quite a bit of fun math.

This project aims prove the optimal strategy for winning the game. This could be either fully deterministic, or we might need to train a neural network for it. I'm not sure yet. Let's start with the source code for the original game, and have Claude Code go at it. See how far we get.

## Analysis

1. I asked Fable 5: _"see @README.md for the stated purpose of this project. I have a clean mirror of the game's (JS) code in src/. We should first explicitly define the routes to finishing the game, then whittling it down by proving some routes are always longer than others, until we have a manageable set to drill down on."_ Result: `ROUTES.md` outlines the routes, as well as decision axes to consider and some hypotheses on which decisions are likely in the optimal route. Side note: I feel this is a strong start, considering Fable never actually _played_ the game. It got all this just from the source code.
2. Fable suggested to implement a battle simulator. We had a back-and-forth about what aspects to test and updated `ROUTES.md` accordingly.