// 用 macOS 自带的行楷（Xingkai SC Bold，与宣传片片名同一款）把开始菜单的大字「弈」渲染成图：
//   swift scripts/make-title.swift
// 输出 src/ui/assets/title-yi.png（白字透明底，界面里当遮罩用，颜色跟随深浅主题）。
// 程序里只带这张图、不带字体文件：行楷是系统字体，不能随程序分发，Windows / Linux 上也没有。
// 行楷是按需下载的字体：若提示找不到，先在「字体册」里搜索「行楷」并下载。
import AppKit
import CoreText

let text = "弈"
let emPx: CGFloat = 640            // 渲染字号（像素）；界面里约 130 设计像素，留足 4 倍以上的清晰度
let pad: CGFloat = 16

// 找到行楷字库文件（按需字体放在 AssetsV2 里）
func findFont() -> URL? {
    let fm = FileManager.default
    var dirs = ["/System/Library/Fonts/Supplemental", "/Library/Fonts", NSHomeDirectory() + "/Library/Fonts"]
    if let assets = try? fm.contentsOfDirectory(atPath: "/System/Library/AssetsV2") {
        for a in assets where a.hasPrefix("com_apple_MobileAsset_Font") {
            let base = "/System/Library/AssetsV2/" + a
            for s in (try? fm.contentsOfDirectory(atPath: base)) ?? [] where s.hasSuffix(".asset") { dirs.append(base + "/" + s + "/AssetData") }
        }
    }
    for d in dirs where fm.fileExists(atPath: d + "/Xingkai.ttc") { return URL(fileURLWithPath: d + "/Xingkai.ttc") }
    return nil
}

guard let url = findFont(),
      let descs = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
      let desc = descs.first(where: { (CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String) == "STXingkaiSC-Bold" }) ?? descs.first
else { print("找不到行楷（Xingkai.ttc），请先在「字体册」里下载"); exit(1) }

let font = CTFontCreateWithFontDescriptor(desc, emPx, nil)
let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor.white]))
let bounds = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)

let w = Int(ceil(bounds.width + 2 * pad)), h = Int(ceil(bounds.height + 2 * pad))
let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setShouldAntialias(true)
ctx.textPosition = CGPoint(x: pad - bounds.minX, y: pad - bounds.minY)
CTLineDraw(line, ctx)

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "src/ui/assets/title-yi.png")
try? FileManager.default.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: out)
print("已生成 \(out.path)（\(w)×\(h)，字形 \(Int(bounds.width))×\(Int(bounds.height))，em \(Int(emPx))）")
