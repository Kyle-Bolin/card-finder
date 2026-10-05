# card-finder

Checks your local game stores' TCGplayer Pro web stores for the cards you've tagged as
**unowned** in your Moxfield decks, and notifies you when one is in stock.

> Work in progress. See the [MVP epic](https://github.com/Kyle-Bolin/card-finder/issues/1)
> for the plan.

## Setup

Requires [uv](https://docs.astral.sh/uv/).

```sh
uv sync
cp config.example.yaml config.yaml   # then edit with your decks and stores
uv run card-finder --help
```

## Development

```sh
uv run pytest              # tests (no network; live tests are marked `live`)
uv run ruff check          # lint
uv run ruff format         # format
```
