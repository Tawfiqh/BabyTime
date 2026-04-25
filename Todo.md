- ✅ I'm aware of yuzukam which looks great, but it looks involved to setup and i don't think it supports push notifications. So i'd rather roll my own and see how it goes.
- ✅ Has a main root and also /viewer /camera
- ✅ Going to the main view you choose to be CAMERA or VIEWERs - only have to pick this once and then it is remembered by the device

- Server needs to calculate the average level of the incoming audio and display a graph of "audio-level" over time for the last 10minutes

- If there are any significant blips (with a configurable threshold) then it should send a push notification to the viewer's phone!

- Camera should periodically ping (every 5 seconds) 
    - CAMERA SLOW UPDATE
    - Sends the latest image
    - And the latest sound reading

- New page: slow viewer
    - Just shows the latest image
    - and sound level readin

- Camera styling should show a dim screen that says - transmitting, please goto X.x.x.x/baby-viewer to view the stream and get notifications
