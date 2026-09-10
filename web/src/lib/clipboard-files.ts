type ClipboardFileItem = Pick<DataTransferItem, "kind" | "getAsFile">;

type ClipboardFileData = {
  files: ArrayLike<File>;
  items: ArrayLike<ClipboardFileItem>;
};

export function clipboardFiles(data: ClipboardFileData) {
  const files = Array.from(data.files);
  if (files.length) return files;
  return Array.from(data.items).flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file ? [file] : [];
  });
}

export function isGifMediaType(mediaType: string) {
  return mediaType.toLowerCase().startsWith("image/gif");
}
