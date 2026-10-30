import AppKit
let target=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
try FileManager.default.createDirectory(at:target,withIntermediateDirectories:true)
for size in [16,32,64,128,256,512,1024] {
 let image=NSImage(size:NSSize(width:size,height:size));image.lockFocus()
 let scale=CGFloat(size)/1024;let transform=NSAffineTransform();transform.scale(by:scale);transform.concat()
 NSColor(calibratedRed:0.08,green:0.10,blue:0.13,alpha:1).setFill();NSBezierPath(roundedRect:NSRect(x:40,y:40,width:944,height:944),xRadius:205,yRadius:205).fill()
 NSColor(calibratedRed:0.88,green:0.92,blue:0.98,alpha:1).setStroke();let screen=NSBezierPath(roundedRect:NSRect(x:167,y:265,width:690,height:475),xRadius:45,yRadius:45);screen.lineWidth=30;screen.stroke()
 NSColor(calibratedRed:0.91,green:0.72,blue:0.39,alpha:1).setFill();NSBezierPath(roundedRect:NSRect(x:225,y:385,width:335,height:290),xRadius:25,yRadius:25).fill()
 NSColor(calibratedRed:0.35,green:0.47,blue:0.62,alpha:1).setFill();for y in [385,545]{NSBezierPath(roundedRect:NSRect(x:600,y:y,width:195,height:130),xRadius:22,yRadius:22).fill()}
 NSColor(calibratedWhite:0.8,alpha:1).setFill();NSBezierPath(roundedRect:NSRect(x:380,y:170,width:264,height:28),xRadius:14,yRadius:14).fill()
 image.unlockFocus();let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!;try bitmap.representation(using:.png,properties:[:])!.write(to:target.appendingPathComponent("\(size).png"))
}
