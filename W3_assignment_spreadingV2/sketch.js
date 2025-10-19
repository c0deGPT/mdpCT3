let grid
let next

let mask = []
let maskImage

let dA = 1
let dB = 0.5
let feed = 0.057
let k =0.053

let gridInterval
let genNum

function setup() {
  createCanvas(600, 600)
  pixelDensity(1)

  textSize(18)
  textAlign(CENTER, CENTER)
  text("Drop your image here", width/2, height/2)

  let dropZone = select('canvas')
  dropZone.dragOver(() => background(150))
  dropZone.drop(handleFile)
}

function handleFile(file) {
  if (file.type === 'image') {
    maskImage = loadImage(file.data, () => {
      console.log("Image loaded successfully.")
      
      let maxSize = 800
      let scale = min(maxSize / maskImage.width, maxSize / maskImage.height)
      let newWidth = floor(maskImage.width * scale)
      let newHeight = floor(maskImage.height * scale)
      
      maskImage.resize(newWidth, newHeight)
      resizeCanvas(maskImage.width, maskImage.height)

      // if (maskImage.width >= maskImage.height){
      //   maskImage.resize(width, 0)
      // } else {
      //   maskImage.resize(0, height)
      // }
      createMask()
      genGrid()
      startGridGeneration()
    })
  }
}

function startGridGeneration() {
  if (gridInterval) {
    clearInterval(gridInterval)
  }
  
  gridInterval = setInterval(() => {
    genNum = floor(random(1, 5))

    for (let i = 0; i < genNum; i++) {
      generateSingleGrid()
    }
  }, 1000)
}

function generateSingleGrid() {
  let radius = 10
  let attempts = 0
  let maxAttempts = 50
  
  while (attempts < maxAttempts) {
    let randomX = floor(random(0 + radius, width - radius))
    let randomY = floor(random(0 + radius, height - radius))
    
    if (!mask[randomX][randomY]) {
      for (let i = randomX - radius; i <= randomX + radius; i++) {
        for (let j = randomY - radius; j <= randomY + radius; j++) {
          let dx = i - randomX
          let dy = j - randomY
          let distance = sqrt(dx * dx + dy * dy)
          
          if (distance <= radius && i >= 0 && i < width && j >= 0 && j < height && !mask[i][j]) {
            grid[i][j].b = 1
          }
        }
      }
      console.log("Generated grid at:", randomX, randomY)
      break
    }
    attempts++
  }
}

function draw() {
  if (!maskImage || !grid || grid.length === 0) {
    return
  }

  background(51)
  for(let x = 1; x < width - 1; x++){
    for(let y = 1; y < height - 1; y++){
      if(mask[x][y]) {
        continue
      }

      let a = grid[x][y].a
      let b = grid[x][y].b
      next[x][y].a = a + (dA * laplaceA(x, y)) - (a * b * b) + (feed * (1-a))
      next[x][y].b = b + (dB * laplaceB(x, y)) + (a * b * b) - ((k + feed) * b)
      
      next[x][y].a = constrain(next[x][y].a, 0 ,1)
      next[x][y].b = constrain(next[x][y].b, 0 ,1)
    }
  }
  
  loadPixels()
  for(let x = 0; x < width; x++){
    for(let y = 0; y < height; y++){
      let pix = (x + y * width) * 4

      if(mask[x][y]) {
        //let imgPix = (x + y * width) * 4
        pixels[pix + 0] = maskImage.pixels[pix + 0]
        pixels[pix + 1] = maskImage.pixels[pix + 1]
        pixels[pix + 2] = maskImage.pixels[pix + 2]
        pixels[pix + 3] = 255
      } else {
        
        let a = next[x][y].a
        let b = next[x][y].b
        let c = floor((a-b) * 255)
        let bgBrightness = 230
    
        if(c < 200) {
          pixels[pix + 0] = 200 - c
          pixels[pix + 1] = 0
          pixels[pix + 2] = 0
          pixels[pix + 3] = 255
        } else {
          pixels[pix + 0] = bgBrightness
          pixels[pix + 1] = bgBrightness
          pixels[pix + 2] = bgBrightness
          pixels[pix + 3] = 255
        }
      }
    }
  }

  updatePixels()
  swap()
}

function laplaceA(x, y){
  let sumA = 0
  sumA += grid[x][y].a * -1
  sumA += grid[x-1][y].a * 0.2
  sumA += grid[x+1][y].a * 0.2
  sumA += grid[x][y-1].a * 0.2
  sumA += grid[x][y+1].a * 0.2
  sumA += grid[x-1][y-1].a * 0.05
  sumA += grid[x+1][y-1].a * 0.05
  sumA += grid[x-1][y+1].a * 0.05
  sumA += grid[x+1][y+1].a * 0.05
  
  return sumA
}

function laplaceB(x,y){
  let sumB = 0
  sumB += grid[x][y].b * -1
  sumB += grid[x-1][y].b * 0.2
  sumB += grid[x+1][y].b * 0.2
  sumB += grid[x][y-1].b * 0.2
  sumB += grid[x][y+1].b * 0.2
  sumB += grid[x-1][y-1].b * 0.05
  sumB += grid[x+1][y-1].b * 0.05
  sumB += grid[x-1][y+1].b * 0.05
  sumB += grid[x+1][y+1].b * 0.05
  
  return sumB
}

function swap(){
  let temp = grid
  grid = next
  next = temp
}

function createMask() {
  maskImage.loadPixels()
  mask = []
  for(let x = 0; x < width; x++){
    mask[x] = []
    for(let y = 0; y < height; y++){
      let pix = (x + y * width) * 4
      let r = maskImage.pixels[pix + 0]
      let g = maskImage.pixels[pix + 1]
      let b = maskImage.pixels[pix + 2]
      let brightness = (r + g + b) / 3

      mask[x][y] = brightness < 100
    }
  }
}

function genGrid(){
  grid = []
  next = []
  for(let x = 0; x < width; x++){
    grid[x] = []
    next[x] = []
    for(let y = 0; y < height; y++){
      grid[x][y] = {a: 1, b: 0}
      next[x][y] = {a: 1, b: 0}
    }
  }
  
  // for (let n = 0; n < 80; n++) {
  //   let radius = 10
  //   let randomX = floor(random(0 + radius, width - radius))
  //   let randomY = floor(random(0 + radius, height - radius))

  //   if(!mask[randomX][randomY]) {
  //     for (let i = randomX - radius; i <= randomX + radius; i++){
  //       for (let j = randomY - radius; j <= randomY + radius; j++){
  //         let dx = i - randomX
  //         let dy = j - randomY
  //         let distance = sqrt(dx * dx + dy * dy)

  //         if(distance <= radius && i >= 0 && i < width && j >= 0 && j < height && !mask[i][j]) {
  //           grid[i][j].b = 1
  //         } 
  //       }
  //     }
  //   }
  // }
}