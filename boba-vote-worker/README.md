# Boba Bracket voting API

Cloudflare Worker + D1 behind the voting page at `food/boba-vote/`.

## Deploy (once, from this folder)

```sh
npm install
npx wrangler login                                   # opens your browser
npx wrangler d1 create boba-bracket                  # copy the database_id it prints
#   paste that id into wrangler.toml, replacing REPLACE_WITH_DATABASE_ID
npx wrangler d1 execute boba-bracket --remote --file schema.sql
npx wrangler deploy                                  # prints https://boba-bracket.<you>.workers.dev
npx wrangler secret put HOST_PIN                     # type a PIN when asked
```

Then set `DEFAULT_API` in `food/boba-vote/index.html` to the workers.dev URL
(or open the page once with `?api=<url>`, which the browser remembers).

## Pages

- Tasters: `/food/boba-vote/`
- Host (rounds, progress, pour sheet with cup letters): `/food/boba-vote/#host`
- Reveal (TV): `/food/boba-vote/#reveal`

## Local dev

`.dev.vars` holds local PINs. `npx wrangler d1 execute boba-bracket --local --file schema.sql`, then `npx wrangler dev`.
