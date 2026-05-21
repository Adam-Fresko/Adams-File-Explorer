import { useEffect, useState } from "react";

type FileIconProps = {
  isDir: boolean;
  kindLabel: string;
  appIconDataUrl?: string;
  thumbnailDataUrl?: string;
  className?: string;
};

type FileVariant = "generic" | "image" | "media" | "archive" | "code" | "document";

const IMAGE_EXTENSIONS = new Set(["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG", "HEIC", "TIFF"]);
const MEDIA_EXTENSIONS = new Set(["MP3", "WAV", "AIF", "AUDIO", "MP4", "MOV", "AVI", "MKV"]);
const ARCHIVE_EXTENSIONS = new Set(["ZIP", "RAR", "7Z", "TAR", "GZ", "BZ2"]);
const CODE_EXTENSIONS = new Set([
  "TS",
  "TSX",
  "JS",
  "JSX",
  "JSON",
  "RS",
  "GO",
  "PY",
  "JAVA",
  "SWIFT",
  "RB",
  "C",
  "CPP",
  "H",
  "MD",
  "YAML",
  "YML",
  "TOML",
  "CSS",
  "HTML"
]);
const DOC_EXTENSIONS = new Set(["TXT", "PDF", "DOC", "DOCX", "RTF", "PAGES", "XLS", "XLSX"]);

const extensionFromKind = (kindLabel: string): string | null => {
  if (!kindLabel.endsWith(" File")) {
    return null;
  }
  return kindLabel.replace(" File", "");
};

const variantForKind = (kindLabel: string): FileVariant => {
  const extension = extensionFromKind(kindLabel);
  if (!extension) {
    return "generic";
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (MEDIA_EXTENSIONS.has(extension)) {
    return "media";
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return "archive";
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return "code";
  }
  if (DOC_EXTENSIONS.has(extension)) {
    return "document";
  }

  return "generic";
};

const FILE_STYLE_BY_VARIANT: Record<FileVariant, string> = {
  generic: "fill-[#f8f8f8] stroke-[#7f7f7f]",
  image: "fill-[#fff1d8] stroke-[#d88c2e]",
  media: "fill-[#e2f3ff] stroke-[#3176c8]",
  archive: "fill-[#efe5ff] stroke-[#7857b4]",
  code: "fill-[#e6f7ec] stroke-[#2b8b5f]",
  document: "fill-[#fff2f0] stroke-[#ca5f4d]"
};

export function FileIcon({
  isDir,
  kindLabel,
  appIconDataUrl,
  thumbnailDataUrl,
  className = "h-4 w-4"
}: FileIconProps) {
  const [failedImageDataUrls, setFailedImageDataUrls] = useState<string[]>([]);

  useEffect(() => {
    setFailedImageDataUrls([]);
  }, [appIconDataUrl, thumbnailDataUrl]);

  if (isDir) {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path
          d="M3.75 6.75C3.75 5.92 4.42 5.25 5.25 5.25H9.1C9.42 5.25 9.72 5.38 9.93 5.6L11.12 6.8C11.33 7.01 11.63 7.14 11.95 7.14H18.75C19.58 7.14 20.25 7.81 20.25 8.64V17.25C20.25 18.08 19.58 18.75 18.75 18.75H5.25C4.42 18.75 3.75 18.08 3.75 17.25V6.75Z"
          className="fill-[#f4cf7a] stroke-[#a8742d]"
          strokeWidth="1.2"
        />
      </svg>
    );
  }

  const imageDataUrl = [thumbnailDataUrl, appIconDataUrl].find(
    (src): src is string => !!src && !failedImageDataUrls.includes(src)
  );
  const imageFit = imageDataUrl === thumbnailDataUrl ? "object-cover" : "object-contain";

  if (imageDataUrl) {
    return (
      <img
        src={imageDataUrl}
        alt=""
        className={`${className} shrink-0 rounded-sm ${imageFit}`}
        aria-hidden
        onError={() => {
          setFailedImageDataUrls((current) =>
            current.includes(imageDataUrl) ? current : [...current, imageDataUrl]
          );
        }}
      />
    );
  }

  const variant = variantForKind(kindLabel);
  const fileStyle = FILE_STYLE_BY_VARIANT[variant];

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M6 3.75H13.6C13.86 3.75 14.11 3.85 14.3 4.04L18.96 8.7C19.15 8.89 19.25 9.14 19.25 9.4V20.25H6C5.45 20.25 5 19.8 5 19.25V4.75C5 4.2 5.45 3.75 6 3.75Z"
        className={fileStyle}
        strokeWidth="1.2"
      />
      <path
        d="M13.5 4V8.5H18"
        stroke="currentColor"
        strokeWidth="1.2"
        className="text-muted-foreground"
      />
    </svg>
  );
}
