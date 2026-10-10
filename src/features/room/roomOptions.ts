import { ScreenSharePresets, VideoPresets, type RoomOptions, type ScreenShareCaptureOptions } from 'livekit-client';

export const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h540.resolution },
  publishDefaults: {
    simulcast: true,
    videoEncoding: VideoPresets.h540.encoding,
    screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
    red: true,
    dtx: true,
  },
};

export const SCREEN_CAPTURE: ScreenShareCaptureOptions = {
  audio: true,
  contentHint: 'detail',
  resolution: ScreenSharePresets.h1080fps15.resolution,
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  systemAudio: 'include',
};
