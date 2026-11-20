package com.tetramote.remote

/** The decoders outlive any one view, so a remounted RemoteScreenView picks up the running stream. */
object RemoteMedia {
    val video = VideoDecoder()
    val audio = AudioPlayer()
}
