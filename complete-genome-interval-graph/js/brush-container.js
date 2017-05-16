class BrushContainer {

  constructor(frame) {
    this.frame = frame;
    this.reset();
  }

  reset() {
    this.activeId = null;
    this.originalSelection = null;
    this.currentSelection = null;
    this.totalBrushWidth = this.frame.genomeScale.range()[1] - this.frame.genomeScale.range()[0];
    this.otherSelections = [];
    this.fragments = [];
    this.visibleFragments = [];
    this.visibleIntervals = [];
    this.panelWidth = 0;
    this.panelHeight = 0;
  }

  render() {
    this.reset();
    this.createBrush();
    this.update();
  }

  createBrush() {
    var self = this;
    var brush = d3.brushX()
      .extent([[0, 0], [this.totalBrushWidth, this.frame.margins.brushes.height]])
      .on('start', function() {
        // brush starts here
        self.originalSelection = d3.event.selection;
        self.activeId = d3.select(this).datum().id;
      })
      .on('brush', function() {
        // brushing happens here

        // ignore brush-by-zoom
        if (d3.event.sourceEvent && d3.event.sourceEvent.type === 'zoom') return;

        // Only transition after input.
        if (!d3.event || !d3.event.sourceEvent || (d3.event.sourceEvent.type === 'brush')) return;

        let fragment = d3.select(this).datum();
		
        let originalSelection = fragment.selection;
        let currentSelection = d3.event.selection;
        let selection = Object.assign([], currentSelection);
        let node;
        
        // read the current state of all the self.fragments before you start checking on collisions
        self.otherSelections = self.fragments.filter((d, i) => (d.selection !== null) && (d.id !== self.activeId)).map((d, i) => {
          node = d3.select('#brush-' + d.id).node();
          return node && d3.brushSelection(node); 
        });

		// calculate the lower allowed selection edge this brush can move
        let lowerEdge = d3.max(self.otherSelections.filter((d, i) => (d.selection !== null))
		  .filter((d, i) => originalSelection && (d[0] <= originalSelection[0]) && (originalSelection[0] <= d[1]))
		  .map((d, i) => d[1]));
		  
		// calculate the upper allowed selection edge this brush can move
        let upperEdge = d3.min(self.otherSelections.filter((d, i) => (d.selection !== null))
		  .filter((d, i) => originalSelection && (d[1] >= originalSelection[0]) && (originalSelection[1] <= d[1]))
		  .map((d, i) => d[0]));

		// if there is an upper edge, then set this to be the upper bound of the current selection
        if ((upperEdge !== undefined) && (selection[1] >= upperEdge)) {
          selection[1] = upperEdge;
          selection[0] = d3.min([selection[0], upperEdge - 1]);
        } 
		// if there is a lower edge, then set this to the be the lower bound of the current selection
        if ((lowerEdge !== undefined) && (selection[0] <= lowerEdge)) {
          selection[0] = lowerEdge;
          selection[1] = d3.max([selection[1], lowerEdge + 1]);
        }
		
		// move the brush to stay within the allowed bounded selection zone
        if ((selection !== undefined) && (selection !== null) && (selection[1] !== selection[0])) {
          d3.select(this).call(fragment.brush.move, selection);
        }
		
		// finally, update the chart with the selection in question
        self.update();
      })
      .on('end', function() {
        // ignore brush-by-zoom
        if (d3.event.sourceEvent && d3.event.sourceEvent.type === 'zoom') return;
        
        // Only transition after input.
        if (!d3.event.sourceEvent) return;

        // Ignore empty selections.
        if (!d3.event.selection) return;

        // Figure out if our latest brush has a selection
        let lastBrushID = self.fragments[self.fragments.length - 1].id;
        let lastBrush = d3.select('#brush-' + lastBrushID).node();
        let selection = d3.brushSelection(lastBrush);

        // If it does, that means we need another one
        if (selection && selection[0] !== selection[1]) {
          self.createBrush();
        }

		// finally, update the chart with the selection in question
        self.update();
    });

    this.fragments.push(new Fragment(brush));
  }

  update() {

    // first recalculate the current selections
    this.updateFragments();

    // update clipPath
    this.renderClipPath();

    // draw the brushes
    this.renderBrushes();

    // Draw the panel rectangles
    this.renderPanels();

    // Draw the intervals
    this.renderIntervals();

    // Draw the interconnections
    //this.renderInterconnections();
  }

  updateFragments() {
    let node;
    this.visibleFragments = [];
    this.visibleIntervals = [];
    this.connections = [];

	// delete any brushes that have a zero selection size
    this.fragments = this.fragments.filter((d, i) => (d.selection === null) || (d.selection[0] !== d.selection[1]));

	// filter the brushes that are visible on the screen
    this.fragments.forEach((fragment, i) => {
      node = d3.select('#brush-' + fragment.id).node();
      fragment.selection = node && d3.brushSelection(node);
      fragment.domain = fragment.selection && fragment.selection.map(this.frame.genomeScale.invert,this.frame.genomeScale);
      if (fragment.selection) {
        this.visibleFragments.push(Object.assign({}, fragment));
      }
    });

    // determine the new Panel Width
    this.panelWidth = (this.frame.width - (this.visibleFragments.length - 1) * this.frame.margins.panels.gap) / this.visibleFragments.length;
    this.panelHeight = this.frame.height - this.frame.margins.panels.upperGap + this.frame.margins.top;

    // now sort the visible self.fragments from smallest to highest
    this.visibleFragments = Object.assign([], this.visibleFragments.sort((x, y) => d3.ascending(x.selection[0], y.selection[0])));

	// Determine the panel parameters for rendering
    this.visibleFragments.forEach((d, i) => {
      d.panelWidth = this.panelWidth;
      d.panelHeight = this.panelHeight;
      d.range = [i * (d.panelWidth + this.frame.margins.panels.gap), (i + 1) * d.panelWidth + i * this.frame.margins.panels.gap];
      d.scale = d3.scaleLinear().domain(d.domain).range(d.range);
      d.innerScale = d3.scaleLinear().domain(d.domain).range([0, d.panelWidth]);
      d.axis = d3.axisBottom(d.innerScale).tickValues(d.innerScale.ticks().concat(d.innerScale.domain())).tickFormat(d3.format(".3s"));
      d.zoom = d3.zoom().scaleExtent([1, Infinity]).translateExtent([[0, 0], [this.frame.width, d.panelHeight]]).extent([[0, 0], [this.frame.width, d.panelHeight]]).on('zoom', () => this.zoomed(d));
      // filter the intervals
	  this.frame.intervals
      .filter((e, j) => (e.startPlace <= d.domain[1]) && (e.startPlace >= d.domain[0]) && (e.endPlace <= d.domain[1]) && (e.endPlace >= d.domain[0]))
      .forEach((e, j) => {
        let interval = Object.assign({}, e);
        interval.identifier = Misc.guid;
        interval.range = [d.scale(interval.startPlace), d.scale(interval.endPlace)];
        interval.shapeWidth = interval.range[1] - interval.range[0];
        this.visibleIntervals.push(interval);
      });
	  // filter the connections
      this.frame.connections
      .filter((e, j) => (e.type !== 'LOOSE') && (e.source.place <= d.domain[1]) && (e.source.place >= d.domain[0]) && (e.sink.place <= d.domain[1]) && (e.sink.place >= d.domain[0]))
      .forEach((e, j) => {
        let connection = Object.assign({}, e);
        connection.identifier = Misc.guid;
        connection.points = [[d.scale(connection.source.place), this.frame.yScale(connection.source.y)], [d.scale(connection.sink.place), this.frame.yScale(connection.source.y)]];
        connection.render = connection.line(connection.points);
        this.connections.push(connection);
      });
    });
  }

  zoomed(fragment) {
	var self = this;
    if (d3.event.sourceEvent && d3.event.sourceEvent.type === 'brush') return; // ignore zoom-by-brush
	// set this brush as active
	this.activeId = fragment.id;
	
	// Get the generated domain upon zoom 
    let t = d3.event.transform;
	let zoomedDomain = t.rescaleX(this.frame.genomeScale).domain();
	let domain = Object.assign([], zoomedDomain);
	
	// Calculate the other domains and the domain bounds for the current brush
	let otherDomains = this.fragments.filter((d, i) => (d.selection !== null) && (d.id !== fragment.id)).map((d, i) => d.domain);
	let lowerBound = d3.max(otherDomains.filter((d, i) => fragment.domain && (d[1] <= fragment.domain[0])).map((d, i) => d[1]));
	let upperBound = d3.min(otherDomains.filter((d, i) => fragment.domain && (d[0] >= fragment.domain[1])).map((d, i) => d[0]));
	
	// if there is an upper bound, set this to the maximum allowed limit
	if ((upperBound !== undefined) && (domain[1] >= upperBound)) {
	  domain[1] = upperBound;
	  domain[0] = d3.min([domain[0], upperBound - 1]);
	} 
	// if there is a lower bound, set this to the lowest allowed limit
	if ((lowerBound !== undefined) && (domain[0] <= lowerBound)) {
	  domain[0] = lowerBound;
	  domain[1] = d3.max([domain[1], lowerBound + 1]);
	}
	
	// update the current brush
	fragment.scale.domain(domain);
	let selection = [this.frame.genomeScale(domain[0]), this.frame.genomeScale(domain[1])];
    d3.select('#brush-' + fragment.id).call(fragment.brush.move,selection);
	
	// update the data
    this.updateFragments();
	
	// update the current brush
	this.frame.brushesContainer.selectAll('.brush')
      .data(this.fragments,  (d, i) => d.id)
      .each(function (e, j){
        d3.select(this)
         .classed('highlighted', (d, i) => d.id === self.activeId)
      });

    //update the panel axis
    this.frame.panelsAxisContainer.selectAll('g.axis')
      .data(this.visibleFragments,  (d, i) => d.id)
      .each(function(d,i) { 
        d3.select(this).call(d.axis).selectAll('text').attr('transform', 'rotate(45)').style('text-anchor', 'start'); 
      });

    // update the intervals
    this.renderIntervals();
  }

  renderClipPath() {
    if (this.visibleFragments.length > 0) {
      this.frame.svgFilter.renderClipPath(this.panelWidth, this.panelHeight);
    }
  }

  renderBrushes() {
    var self = this;

    let brushSelection = this.frame.brushesContainer.selectAll('.brush')
      .data(this.fragments,  (d, i) => d.id);

    // Set up new brushes
    brushSelection
      .enter()
      .insert('g', '.brush')
      .attr('class', 'brush')
      .attr('id', (d, i) => 'brush-' + d.id)
      .each(function(fragment) {
        //call the brush
        d3.select(this).call(fragment.brush);
      });

    // update the brushes
    brushSelection
      .each(function (fragment){
        d3.select(this)
          .attr('class', 'brush')
          .classed('highlighted', (d, i) => d.id === self.activeId)
          .selectAll('.overlay')
          .style('pointer-events',(d,i) => {
            let brush = fragment.brush;
            if (fragment.id === self.fragments[self.fragments.length - 1].id && brush !== undefined) {
              return 'all';
            } else {
              return 'none';
            }
          });
      })

    // exit the brushes
    brushSelection
      .exit()
      .remove();
  }

  renderPanels() {
    let self = this;
    let correctionOffset = 1; // used for aligning the rectenges on the y Axis lines

    // Draw the panel rectangles
    let panelRectangles = this.frame.panelsContainer.selectAll('rect.panel')
      .data(this.visibleFragments,  (d, i) => d.id);

    panelRectangles
      .enter()
      .append('rect')
      .attr('class', 'panel')
      .style('clip-path','url(#clip)')
      //.transition()
      .attr('transform', (d, i) => 'translate(' + [d.range[0], 0] + ')')
      .attr('width', (d, i) => d.panelWidth)
      .attr('height', (d, i) => d.panelHeight + correctionOffset)
      .each(function(d,i) {
        d3.select(this)
          .call(d.zoom.transform, d3.zoomIdentity
          .scale(self.frame.width / (d.selection[1] - d.selection[0]))
          .translate(-d.selection[0], 0));
      });

    panelRectangles
      //.transition()
      .attr('transform', (d, i) => 'translate(' + [d.range[0], 0] + ')')
      .attr('width', (d, i) => d.panelWidth)
      .each(function(d,i) {
        d3.select(this).call(d.zoom)
         .call(d.zoom.transform, d3.zoomIdentity
         .scale(self.frame.width / (d.selection[1] - d.selection[0]))
         .translate(-d.selection[0], 0));
      });

    panelRectangles
      .exit()
      .remove();

    //Axis
    let panelsAxis = this.frame.panelsAxisContainer.selectAll('g.axis')
      .data(this.visibleFragments,  (d, i) => d.id);

    panelsAxis
      .enter()
      .append('g')
      .attr('class', 'chromo-axis axis axis--x')
      //.transition()
      .attr('transform', (d, i) => 'translate(' + [d.range[0], 0] + ')')
      .each(function(d,i) { 
        d3.select(this).call(d.axis).selectAll('text').attr('transform', 'rotate(45)').style('text-anchor', 'start'); 
      });

    panelsAxis
      //.transition()
      .attr('transform', (d, i) => 'translate(' + [d.range[0], 0] + ')')
      .each(function(d,i) { 
        d3.select(this).call(d.axis).selectAll('text').attr('transform', 'rotate(45)').style('text-anchor', 'start'); 
      });

    panelsAxis
      .exit()
      .remove();
  }

  renderIntervals() {
    let shapes = this.frame.shapesContainer.selectAll('rect.shape')
      .data(this.visibleIntervals, (d, i) => d.identifier);

    shapes
      .enter()
      .append('rect')
      .attr('class', 'popovered shape')
      //.transition()
      .attr('transform', (d, i) => 'translate(' + [d.range[0], this.frame.yScale(d.y) - 0.5 * this.frame.margins.intervals.bar] + ')')
      .attr('width', (d, i) => d.shapeWidth)
      .attr('height', this.frame.margins.intervals.bar)
      .style('fill', (d, i) => d.color)
      .style('stroke', (d, i) => d3.rgb(d.color).darker(1))
      .on('mouseover', function(d,i) {
        d3.select(this).classed('highlighted', true);
      })
      .on('mouseout', function(d,i) {
        d3.select(this).classed('highlighted', false);
      })
      .on('mousemove', (d,i) => this.loadPopover(d));

    shapes
      //.transition()
      .attr('transform', (d, i) => 'translate(' + [d.range[0], this.frame.yScale(d.y) - 0.5 * this.frame.margins.intervals.bar] + ')')
      .attr('width', (d, i) => d.shapeWidth)
      .style('fill', (d, i) => d.color)
      .style('stroke', (d, i) => d3.rgb(d.color).darker(1));

    shapes
      .exit()
      .remove();
  }

  renderInterconnections() {
    
    let connections = this.frame.shapesContainer.selectAll('path.connection')
      .data(this.connections, (d,i) => d.identifier);
 
    connections.exit().remove();

    connections
      .attr('class', (d,i) => d.styleClass)
      .style('clip-path', (d,i) => d.clipPath)
      .attr('d', (d,i) => d.render);

    connections
      .enter()
      .append('path')
      .attr('id', (d,i) => d.identifier)
      .attr('class', (d,i) => d.styleClass)
      .style('clip-path', (d,i) =>  d.clipPath)
      .attr('d', (d,i) =>  d.render)
      .on('mouseover', (d,i) => {

      })
      .on('mouseout', (d,i) => {

      })
      .on('mousemove', (d,i) => {
        
      })
      .on('dblclick', (d,i) => {

      });
  }
  
  loadPopover(d) {
    var popover = d3.select('.popover');
    popover.select('.popover-title').html(d.popoverTitle);
    popover.select('.popover-content').html(d.popoverContent);
    popover.select('.popover-content span').style('color', d.color)
    popover
      .style('left', (d3.event.pageX - 0.99 *  popover.node().getBoundingClientRect().width / 2) + 'px')
      .style('top', (d3.event.pageY - 1.39 * popover.node().getBoundingClientRect().height - 3) + 'px')
      .classed('hidden', false)
      .style('display', 'block')
      .transition()
      .duration(5)
      .style('opacity', 1);
  }
  
}