"""Command-line entrypoint for card-finder."""

from typing import Annotated

import typer

from card_finder import __version__

app = typer.Typer(
    help="Check local game store inventories for the unowned cards in your Moxfield decks.",
    no_args_is_help=True,
)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"card-finder {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[
        bool,
        typer.Option(
            "--version",
            callback=_version_callback,
            is_eager=True,
            help="Show the version and exit.",
        ),
    ] = False,
) -> None:
    """Check local game store inventories for the unowned cards in your Moxfield decks."""
