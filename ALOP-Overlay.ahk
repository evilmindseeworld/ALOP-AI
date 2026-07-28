#SingleInstance Force
#NoTrayIcon

overlayURL := "https://alop-m5kdt77wb-evilmindseeworlds-projects.vercel.app?overlay=true"
winTitle := "ALOP-AI Overlay"

; F9 toggles overlay
F9::
{
    if WinExist(winTitle)
    {
        WinClose(winTitle)
        return
    }
    
    ; Get screen dimensions
    screenW := A_ScreenWidth
    screenH := A_ScreenHeight
    
    ; Window size and position (bottom center)
    winW := 900
    winH := 200
    winX := (screenW - winW) // 2
    winY := screenH - winH - 60
    
    ; Launch Chrome in app mode (frameless)
    Run('chrome.exe --app="' overlayURL '" --window-size=' winW ',' winH ' --window-position=' winX ',' winY)
    
    ; Wait for window then make always-on-top
    WinWait(winTitle, , 5)
    if WinExist(winTitle)
    {
        WinSetAlwaysOnTop(1, winTitle)
        WinActivate(winTitle)
    }
    return
}

; Escape closes overlay if open
~Escape::
{
    if WinExist(winTitle)
    {
        WinClose(winTitle)
    }
    return
}

; F10 also closes (backup)
F10::
{
    if WinExist(winTitle)
    {
        WinClose(winTitle)
    }
    return
}
