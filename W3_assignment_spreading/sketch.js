let TILES_X = 100
let TILES_Y = 75

let TILE_W, TILE_H
let FONT
let CHARS = " ▆▇░░▒▓░"
let contrastValue = 1.0
let charInput

let img

function setup() {
  TILES_X = 170
  TILES_Y = 85
  createCanvas(600, 850)

  textFont(FONT || 'monospace')
  textAlign(CENTER, CENTER)
  textSize(TILE_H)

  charInput = createInput(CHARS)
  charInput.input(() => {
    CHARS = charInput.value();
    console.log("New characters: ", CHARS)
  })

  let dropZone = select('canvas')
  dropZone.dragOver(() => background(180))
  dropZone.dragLeave(() => background(200))
  dropZone.drop(handleFile, () => background(200))
}

function handleFile(file) {
  if (file.type === 'image') {
    img = loadImage(file.data, () => {
      console.log("Image loaded successfully.")
      
      let maxWidth = 1000
      let maxHeight = 1000
    
      let newWidth = img.width
      let newHeight = img.height

      if (img.width > maxWidth || img.height > maxHeight) {
        let aspectRatio = img.width / img.height
        if (img.width > img.height) {
          newWidth = maxWidth
          newHeight = Math.round(maxWidth / aspectRatio)
        } else {
          newHeight = maxHeight
          newWidth = Math.round(maxHeight * aspectRatio)
        }
      }
      img.resize(newWidth, newHeight)
      resizeCanvas(newWidth, newHeight)
			
			TILES_X = 80
      TILES_Y = Math.floor(TILES_X * (newHeight / newWidth))
      TILE_W = width / TILES_X
      TILE_H = height / TILES_Y

      textSize(TILE_H)
    })
  } else {
    console.error("The uploaded file is not an image.")
  }
}

function keyPressed() {
  if (key === 'S' || key === 's') {
    saveCanvas('grid_text', 'png')
  }
}

function draw() {
  background("#FFFFFF")

  if (img) {
    let buffer = createGraphics(TILES_X, TILES_Y)
    buffer.background(0)

    buffer.translate(buffer.width / 2, buffer.height / 2)
    buffer.imageMode(CENTER)
    buffer.image(img, 0, 0, TILES_X, TILES_Y)

    for (let x = 0; x < TILES_X; x++) {
      for (let y = 0; y < TILES_Y; y++) {
        let c = buffer.get(x, y)
        let r = adjustContrast(red(c))
        let g = adjustContrast(green(c))
        let b = adjustContrast(blue(c))

        let brightnessValue = (r + g + b) / 3
        let selector = int(map(brightnessValue, 0, 255, CHARS.length, 0))

        push()
        fill(r, g, b)
        translate(x * TILE_W + TILE_W / 2, y * TILE_H + TILE_H / 2)
        text(CHARS.charAt(selector), 0, 0)
        pop()
      }
    }
  } else {
    fill(50)
    textSize(20)
    text("Drop your image here", width / 2, height / 2)
  }
}

function adjustContrast(value) {
  return constrain((value - 128) * contrastValue + 128, 0, 255)
}