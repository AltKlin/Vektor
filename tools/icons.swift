// Generates the Vektor icons from the logo path (viewBox 256):
//   swift tools/icons.swift   (from the repository root)
// -> macos/icon1024.png (macOS template: centered 824 px tile), windows/vektor.ico (16 to 256 px), web/icon-192.png and web/icon-512.png
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let mark: [[CGPoint]] = [
  [CGPoint(x: 58, y: 104), CGPoint(x: 106, y: 104), CGPoint(x: 128, y: 156.38), CGPoint(x: 150, y: 104),
   CGPoint(x: 198, y: 104), CGPoint(x: 152, y: 216), CGPoint(x: 104, y: 216)],
  [CGPoint(x: 36, y: 58), CGPoint(x: 174, y: 58), CGPoint(x: 148, y: 32), CGPoint(x: 182, y: 32),
   CGPoint(x: 232, y: 84), CGPoint(x: 36, y: 84)],
]
let markBox = CGRect(x: 36, y: 32, width: 196, height: 184)
let ink = CGColor(red: 0x14 / 255.0, green: 0x14 / 255.0, blue: 0x14 / 255.0, alpha: 1)
let white = CGColor(red: 1, green: 1, blue: 1, alpha: 1)

/// size: image side; tile: tile (x, y, side, radius); markFrac: logo width / tile side
func render(size: Int, tile: CGRect, radius: CGFloat, markFrac: CGFloat) -> Data {
  let cs = CGColorSpace(name: CGColorSpace.sRGB)!
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.translateBy(x: 0, y: CGFloat(size)); ctx.scaleBy(x: 1, y: -1)   // SVG coordinates (y down)
  ctx.setShouldAntialias(true)
  ctx.addPath(CGPath(roundedRect: tile, cornerWidth: radius, cornerHeight: radius, transform: nil))
  ctx.setFillColor(ink); ctx.fillPath()
  let s = tile.width * markFrac / markBox.width
  ctx.translateBy(x: tile.midX - markBox.midX * s, y: tile.midY - markBox.midY * s)
  ctx.scaleBy(x: s, y: s)
  for poly in mark { ctx.addLines(between: poly); ctx.closePath() }
  ctx.setFillColor(white); ctx.fillPath()
  let img = ctx.makeImage()!
  let out = NSMutableData()
  let dst = CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dst, img, nil); CGImageDestinationFinalize(dst)
  return out as Data
}

// macOS: centered 824/1024 tile, radius ≈ 22.5 %
try render(size: 1024, tile: CGRect(x: 100, y: 100, width: 824, height: 824), radius: 185, markFrac: 0.62)
  .write(to: URL(fileURLWithPath: "macos/icon1024.png"))

// Web (installable app): full-frame tile 192 and 512 px
for n in [192, 512] {
  let f = CGFloat(n)
  try render(size: n, tile: CGRect(x: 0, y: 0, width: f, height: f), radius: f * 0.1875, markFrac: 0.66)
    .write(to: URL(fileURLWithPath: "web/icon-\(n).png"))
}

// Windows: full-frame tile, one PNG image per size in the .ico
let sizes = [16, 24, 32, 48, 64, 128, 256]
let pngs = sizes.map { n -> Data in
  let f = CGFloat(n)
  return render(size: n, tile: CGRect(x: 0, y: 0, width: f, height: f), radius: f * 0.1875, markFrac: n <= 24 ? 0.76 : 0.66)
}
var ico = Data()
func le16(_ v: Int) { var x = UInt16(v).littleEndian; ico.append(Data(bytes: &x, count: 2)) }
func le32(_ v: Int) { var x = UInt32(v).littleEndian; ico.append(Data(bytes: &x, count: 4)) }
le16(0); le16(1); le16(sizes.count)
var offset = 6 + 16 * sizes.count
for (n, d) in zip(sizes, pngs) {
  ico.append(UInt8(n % 256)); ico.append(UInt8(n % 256)); ico.append(0); ico.append(0)
  le16(1); le16(32); le32(d.count); le32(offset); offset += d.count
}
for d in pngs { ico.append(d) }
try ico.write(to: URL(fileURLWithPath: "windows/vektor.ico"))
print("OK macos/icon1024.png, windows/vektor.ico")
