"""Build and verify the downloadable source archive without runtime dependencies."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_PATH = PROJECT_ROOT / "dist" / "TrackPlan_Source.zip"
SOURCE_DIRECTORIES = (".github", "dist", "scripts", "docs", "results")
ROOT_FILES = (
    ".editorconfig",
    ".gitignore",
    ".prettierrc.json",
    "README.md",
    "eslint.config.mjs",
    "package-lock.json",
    "package.json",
    "pyproject.toml",
    "requirements-dev.txt",
)


def source_files():
    """Yield maintained files while excluding the archive and Python caches."""
    for directory_name in SOURCE_DIRECTORIES:
        directory = PROJECT_ROOT / directory_name
        for path in sorted(directory.rglob("*")):
            if path.is_file() and path != ARCHIVE_PATH and "__pycache__" not in path.parts:
                yield path

    for filename in ROOT_FILES:
        path = PROJECT_ROOT / filename
        if path.is_file():
            yield path


def main():
    """Write the source ZIP and fail if any archived member is corrupt."""
    with ZipFile(ARCHIVE_PATH, "w", ZIP_DEFLATED) as archive:
        for path in source_files():
            archive.write(path, path.relative_to(PROJECT_ROOT))

    with ZipFile(ARCHIVE_PATH) as archive:
        corrupt_member = archive.testzip()
        if corrupt_member is not None:
            raise RuntimeError(f"Corrupt ZIP member: {corrupt_member}")
    print(ARCHIVE_PATH)


if __name__ == "__main__":
    main()
