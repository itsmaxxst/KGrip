class GaugeSegmented {
  constructor(canvas, minValue = 0, maxValue = 60) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = canvas.width;
    this.height = canvas.height;
    this.centerX = this.width / 2;
    this.centerY = this.height / 2;
    this.radius = Math.min(this.width, this.height) / 2 - 40;
    this.currentValue = 0;
    this.targetValue = 0;
    this.animationSpeed = 0.05; // Smooth animation

    // Custom value range
    this.minValue = minValue;
    this.maxValue = maxValue;
    this.currentRawValue = minValue;
    this.targetRawValue = minValue;

    // Segment configuration
    this.numSegments = 20 // Fewer, larger segments like the image
    this.segmentGap = 0.05; // Larger gap between segments for clear separation
  }

  // Update the target value (in your device's range: 0-60)
  setValue(value) {
    // Clamp value to valid range
    this.targetRawValue = Math.max(
      this.minValue,
      Math.min(this.maxValue, value),
    );
    // Convert to percentage for internal use
    this.targetValue = this.rawToPercent(this.targetRawValue);
  }

  // Convert raw value to percentage (0-100)
  rawToPercent(rawValue) {
    return ((rawValue - this.minValue) / (this.maxValue - this.minValue)) * 100;
  }

  // Convert percentage back to raw value
  percentToRaw(percent) {
    return (percent / 100) * (this.maxValue - this.minValue) + this.minValue;
  }

  // Animate current value towards target value
  update() {
    if (Math.abs(this.targetValue - this.currentValue) > 0.1) {
      this.currentValue +=
        (this.targetValue - this.currentValue) * this.animationSpeed;
      this.currentRawValue = this.percentToRaw(this.currentValue);
    } else {
      this.currentValue = this.targetValue;
      this.currentRawValue = this.targetRawValue;
    }
  }

  // Get color based on percentage value
  getSegmentColor(segmentPercent) {
    if (segmentPercent < 20) {
      return "#ff0000"; // Red
    } else if (segmentPercent < 35) {
      return "#ffff00"; // Yellow
    } else if (segmentPercent < 50) {
      return "#f0ff00"; // LightGreen
    } else {
      return "#00ff00"; //Gree
    }
  }

  // Draw the gauge with segmented arc
  draw() {
    const ctx = this.ctx;

    // Clear canvas
    ctx.clearRect(0, 0, this.width, this.height);

    const startAngle = 0.75 * Math.PI;
    const totalAngle = 1.5 * Math.PI;
    const segmentAngle =
      (totalAngle - this.segmentGap * (this.numSegments - 1)) /
      this.numSegments;

    // Calculate how many segments should be lit
    const litSegments = Math.floor(
      (this.currentValue / 100) * this.numSegments,
    );
    const partialFill =
      (this.currentValue / 100) * this.numSegments - litSegments;

    // Draw all segments with thicker, more rectangular appearance
    for (let i = 0; i < this.numSegments; i++) {
      const angle1 = startAngle + i * (segmentAngle + this.segmentGap);
      const angle2 = angle1 + segmentAngle;

      // Calculate percentage for this segment
      const segmentPercent = ((i + 0.5) / this.numSegments) * 100;

      ctx.beginPath();
      ctx.arc(this.centerX, this.centerY, this.radius, angle1, angle2);

      // Determine if segment is lit or not
      if (i < litSegments) {
        // Fully lit segment
        ctx.strokeStyle = this.getSegmentColor(segmentPercent);
        ctx.lineWidth = 30; // Thicker for more rectangular/chunky appearance
        ctx.globalAlpha = 1.0;
      } else if (i === litSegments && partialFill > 0.1) {
        // Partially lit segment (transition)
        ctx.strokeStyle = this.getSegmentColor(segmentPercent);
        ctx.lineWidth = 30;
        ctx.globalAlpha = partialFill; // Fade in effect
      } else {
        // Unlit segment - very dark, barely visible
        ctx.strokeStyle = "rgba(40, 40, 40, 0.3)";
        ctx.lineWidth = 35;
        ctx.globalAlpha = 1.0;
      }

      ctx.lineCap = "butt"; // Flat ends for more rectangular appearance
      ctx.stroke();
    }

    // Reset alpha
    ctx.globalAlpha = 1.0;

    // Draw tick marks
    //  this.drawTicks();

    // Draw center circle background
    // ctx.beginPath();
    // ctx.arc(this.centerX, this.centerY, this.radius - 55, 0, 2 * Math.PI);
    // ctx.fillStyle = "rgba(20, 20, 20, 0.9)";
    // ctx.fill();

    // Draw value text (show raw value, not percentage)
    ctx.font = "74px Open Sans";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      (Math.round(this.currentRawValue * 10) / 10),
      this.centerX,
      this.centerY + 110,
    );

    // Draw label with range
    // ctx.font = "16px Arial";
    // ctx.fillStyle = "#888888";
    // ctx.fillText(
    //   `USB DEVICE (${this.minValue}-${this.maxValue})`,
    //   this.centerX,
    //   this.centerY + 40,
    // );

    // Draw needle/pointer
    this.drawTeardropNeedle();
  }

  // Draw tick marks around the gauge
  drawTicks() {
    const ctx = this.ctx;
    const startAngle = 0.75 * Math.PI;
    const totalAngle = 1.5 * Math.PI;
    const majorTicks = 11; // 11 tick marks

    for (let i = 0; i < majorTicks; i++) {
      const angle = startAngle + (i / (majorTicks - 1)) * totalAngle;
      const innerRadius = this.radius + 20;
      const outerRadius = this.radius + 35;

      const x1 = this.centerX + innerRadius * Math.cos(angle);
      const y1 = this.centerY + innerRadius * Math.sin(angle);
      const x2 = this.centerX + outerRadius * Math.cos(angle);
      const y2 = this.centerY + outerRadius * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw tick labels with raw values
      const labelRadius = this.radius + 50;
      const labelX = this.centerX + labelRadius * Math.cos(angle);
      const labelY = this.centerY + labelRadius * Math.sin(angle);

      // Calculate raw value for this tick
      const tickPercent = (i / (majorTicks - 1)) * 100;
      const tickValue = this.percentToRaw(tickPercent);

      ctx.font = "12px Arial";
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(Math.round(tickValue), labelX, labelY);
    }
  }

  // Draw needle pointer (teardrop/water droplet shape)
  drawNeedle() {
    const ctx = this.ctx;
    const startAngle = 0.75 * Math.PI;
    const needleAngle = startAngle + (this.currentValue / 100) * 1.5 * Math.PI;
    const needleLength = this.radius - 60;

    // Tip of the needle
    const tipX = this.centerX + needleLength * Math.cos(needleAngle);
    const tipY = this.centerY + needleLength * Math.sin(needleAngle);

    // Base width of the teardrop
    const baseWidth = 12;

    // Calculate perpendicular angle for the base
    const perpAngle = needleAngle + Math.PI / 2;

    // Base points (left and right of center)
    const baseLeftX = this.centerX + baseWidth * Math.cos(perpAngle);
    const baseLeftY = this.centerY + baseWidth * Math.sin(perpAngle);
    const baseRightX = this.centerX - baseWidth * Math.cos(perpAngle);
    const baseRightY = this.centerY - baseWidth * Math.sin(perpAngle);

    // Control points for smooth curves (creating the teardrop shape)
    const controlLength = needleLength * 0.5;
    const controlLeftX =
      this.centerX +
      baseWidth * 0.7 * Math.cos(perpAngle) +
      controlLength * Math.cos(needleAngle);
    const controlLeftY =
      this.centerY +
      baseWidth * 0.7 * Math.sin(perpAngle) +
      controlLength * Math.sin(needleAngle);
    const controlRightX =
      this.centerX -
      baseWidth * 0.7 * Math.cos(perpAngle) +
      controlLength * Math.cos(needleAngle);
    const controlRightY =
      this.centerY -
      baseWidth * 0.7 * Math.sin(perpAngle) +
      controlLength * Math.sin(needleAngle);

    // Draw shadow
    ctx.save();
    ctx.translate(2, 2);
    ctx.beginPath();
    ctx.moveTo(baseLeftX, baseLeftY);
    ctx.quadraticCurveTo(controlLeftX, controlLeftY, tipX, tipY);
    ctx.quadraticCurveTo(controlRightX, controlRightY, baseRightX, baseRightY);
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fill();
    ctx.restore();

    // Draw teardrop needle
    ctx.beginPath();
    ctx.moveTo(baseLeftX, baseLeftY);
    ctx.quadraticCurveTo(controlLeftX, controlLeftY, tipX, tipY);
    ctx.quadraticCurveTo(controlRightX, controlRightY, baseRightX, baseRightY);
    ctx.closePath();

    // Create gradient for the needle
    const gradient = ctx.createLinearGradient(
      this.centerX,
      this.centerY,
      tipX,
      tipY,
    );
    gradient.addColorStop(0, "#ff3333");
    gradient.addColorStop(1, "#cc0000");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Add subtle stroke
    ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw center dot
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, 8, 0, 2 * Math.PI);
    ctx.fillStyle = "#ff0000";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw needle pointer (teardrop/water droplet shape)
  drawTeardropNeedle() {
    const ctx = this.ctx;
    const startAngle = 0.75 * Math.PI;
    const needleAngle = startAngle + (this.currentValue / 100) * 1.5 * Math.PI;
    const needleLength = this.radius - 60;
    
    // Tip of the needle
    const tipX = this.centerX + needleLength * Math.cos(needleAngle);
    const tipY = this.centerY + needleLength * Math.sin(needleAngle);
    
    // Base width of the teardrop
    const baseWidth = 12;
    
    // Calculate perpendicular angle for the base
    const perpAngle = needleAngle + Math.PI / 2;
    
    // Base points (left and right of center)
    const baseLeftX = this.centerX + baseWidth * Math.cos(perpAngle);
    const baseLeftY = this.centerY + baseWidth * Math.sin(perpAngle);
    const baseRightX = this.centerX - baseWidth * Math.cos(perpAngle);
    const baseRightY = this.centerY - baseWidth * Math.sin(perpAngle);
    
    // Control points for smooth curves (creating the teardrop shape)
    const controlLength = needleLength * 0.5;
    const controlLeftX = this.centerX + baseWidth * 0.7 * Math.cos(perpAngle) + controlLength * Math.cos(needleAngle);
    const controlLeftY = this.centerY + baseWidth * 0.7 * Math.sin(perpAngle) + controlLength * Math.sin(needleAngle);
    const controlRightX = this.centerX - baseWidth * 0.7 * Math.cos(perpAngle) + controlLength * Math.cos(needleAngle);
    const controlRightY = this.centerY - baseWidth * 0.7 * Math.sin(perpAngle) + controlLength * Math.sin(needleAngle);
    
    // Draw shadow
    // ctx.save();
    // ctx.translate(2, 2);
    // ctx.beginPath();
    // ctx.moveTo(baseLeftX, baseLeftY);
    // ctx.quadraticCurveTo(controlLeftX, controlLeftY, tipX, tipY);
    // ctx.quadraticCurveTo(controlRightX, controlRightY, baseRightX, baseRightY);
    // ctx.closePath();
    // ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    // ctx.fill();
    // ctx.restore();
    
    // Draw teardrop needle
    ctx.beginPath();
    ctx.moveTo(baseLeftX, baseLeftY);
    ctx.quadraticCurveTo(controlLeftX, controlLeftY, tipX, tipY);
    ctx.quadraticCurveTo(controlRightX, controlRightY, baseRightX, baseRightY);
    ctx.closePath();
    
    // Create gradient for the needle
    const gradient = ctx.createLinearGradient(this.centerX, this.centerY, tipX, tipY);
    gradient.addColorStop(0, '#404040');
    gradient.addColorStop(1, '#404040');
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Add subtle stroke
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw center dot
    ctx.beginPath();
    ctx.arc(this.centerX, this.centerY, 11, 0, 2 * Math.PI);
    ctx.fillStyle = '#404040';
    ctx.fill();
    ctx.strokeStyle = '#404040';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // Animation loop
  animate() {
    this.update();
    this.draw();
    requestAnimationFrame(() => this.animate());
  }
}
