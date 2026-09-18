export function makeZIP(files) {
  const encoder = new TextEncoder();

  const fileChunks = [];
  const centralDirectory = [];

  let offset = 0;

  function crc32(data) {
    let crc = 0xffffffff;

    for (const byte of data) {
      crc ^= byte;

      for (
        let bit = 0;
        bit < 8;
        bit++
      ) {
        crc =
          (crc >>> 1) ^
          (
            crc & 1
              ? 0xedb88320
              : 0
          );
      }
    }

    return (
      crc ^ 0xffffffff
    ) >>> 0;
  }

  for (
    const [name, text] of
    Object.entries(files)
  ) {
    const encodedName =
      encoder.encode(name);

    const encodedData =
      encoder.encode(text);

    const checksum =
      crc32(encodedData);

    /*
     * Create the local file header.
     * The header is 30 bytes plus the
     * encoded filename.
     */
    const localHeader =
      new Uint8Array(
        30 + encodedName.length,
      );

    const localView =
      new DataView(
        localHeader.buffer,
      );

    // Local file header signature.
    localView.setUint32(
      0,
      0x04034b50,
      true,
    );

    // ZIP version required.
    localView.setUint16(
      4,
      20,
      true,
    );

    // CRC-32 checksum.
    localView.setUint32(
      14,
      checksum,
      true,
    );

    // Compressed size.
    localView.setUint32(
      18,
      encodedData.length,
      true,
    );

    // Original size.
    localView.setUint32(
      22,
      encodedData.length,
      true,
    );

    // Filename length.
    localView.setUint16(
      26,
      encodedName.length,
      true,
    );

    localHeader.set(
      encodedName,
      30,
    );

    fileChunks.push(
      localHeader,
      encodedData,
    );

    /*
     * Create the central-directory
     * entry for this file.
     */
    const centralEntry =
      new Uint8Array(
        46 + encodedName.length,
      );

    const centralView =
      new DataView(
        centralEntry.buffer,
      );

    // Central-directory signature.
    centralView.setUint32(
      0,
      0x02014b50,
      true,
    );

    // ZIP version that created the file.
    centralView.setUint16(
      4,
      20,
      true,
    );

    // ZIP version required.
    centralView.setUint16(
      6,
      20,
      true,
    );

    // CRC-32 checksum.
    centralView.setUint32(
      16,
      checksum,
      true,
    );

    // Compressed size.
    centralView.setUint32(
      20,
      encodedData.length,
      true,
    );

    // Original size.
    centralView.setUint32(
      24,
      encodedData.length,
      true,
    );

    // Filename length.
    centralView.setUint16(
      28,
      encodedName.length,
      true,
    );

    // Position of the local file header.
    centralView.setUint32(
      42,
      offset,
      true,
    );

    centralEntry.set(
      encodedName,
      46,
    );

    centralDirectory.push(
      centralEntry,
    );

    offset +=
      localHeader.length +
      encodedData.length;
  }

  const centralDirectorySize =
    centralDirectory.reduce(
      (total, entry) =>
        total + entry.length,
      0,
    );

  /*
   * Create the end-of-central-directory
   * record.
   */
  const endRecord =
    new Uint8Array(22);

  const endView =
    new DataView(
      endRecord.buffer,
    );

  // End-of-central-directory signature.
  endView.setUint32(
    0,
    0x06054b50,
    true,
  );

  // Number of entries on this disk.
  endView.setUint16(
    8,
    centralDirectory.length,
    true,
  );

  // Total number of entries.
  endView.setUint16(
    10,
    centralDirectory.length,
    true,
  );

  // Size of the central directory.
  endView.setUint32(
    12,
    centralDirectorySize,
    true,
  );

  // Starting position of central directory.
  endView.setUint32(
    16,
    offset,
    true,
  );

  return new Blob(
    [
      ...fileChunks,
      ...centralDirectory,
      endRecord,
    ],
    {
      type: "application/zip",
    },
  );
}