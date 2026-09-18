from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import io


# Locate the main project folder.
root = Path(__file__).resolve().parents[1]

# Location where the source ZIP will be created.
source = root / "dist" / "TrackPlan_Source.zip"


# Create the source-code ZIP archive.
with ZipFile(
    source,
    mode="w",
    compression=ZIP_DEFLATED,
) as archive:

    folders = [
        "dist",
        "scripts",
        "docs",
        "results",
    ]

    for folder in folders:
        folder_path = root / folder

        for path in sorted(
            folder_path.rglob("*"),
        ):
            should_include = (
                path.is_file()
                and path != source
                and "__pycache__"
                not in str(path)
            )

            if should_include:
                archive.write(
                    path,
                    path.relative_to(root),
                )

    # Add the main README file.
    archive.write(
        root / "README.md",
        "README.md",
    )


# Verify that the created ZIP is not corrupted.
for target in [source]:
    with ZipFile(target) as archive:
        assert archive.testzip() is None


# Display the location of the finished ZIP.
print(source)