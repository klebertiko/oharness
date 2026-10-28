# Toward an OHarness Model

An agent receives a task, consults tools, and produces a response. Between intent and result, there are choices: who can act, with what context, when work should stop, and who decides to continue. We want those choices to be readable, open to discussion, and reviewable by the people responsible for the work.

We advocate an OHarness Model that is open to inspection and evolution. A harness brings together agents, capabilities, verification points, and human decisions to organize work. Its description should make the responsibilities behind that organization visible. People using it need to understand what they are delegating.

**Readability is part of control.** Context, instructions, and criteria need a recognizable place. We want people to follow the reasoning behind a composition, review a change, and understand its consequences. Clarity also means stating what is missing, what depends on the environment, and what remains uncertain.

**Portability is a design direction.** We want to take the description of work across environments, preserving its intent and making its dependencies explicit. Every connection has conditions; every environment has limits. A responsible transition should show which parts can carry over, which need adaptation, and which still need verification.

**Connections need to be understandable.** Tools and sources of context extend the reach of agents. We believe their links and permissions should be visible in the composition. Choosing a connection should let you understand what it offers, what it depends on, and what responsibility it adds to the work.

**Authority remains human.** People should define objectives, set limits, examine evidence, and decide what to accept. We want clear points of intervention, with room to stop, decline, and change course. Delegating an activity should preserve the ability to question how it was carried out.

We adopted YAML for `.ohm`, favoring readable instructions, comments, and multiline content. The bundled harnesses that ship as .ohm files and the command line already use this syntax; Studio import and export still use JSON, and the desktop migration is not finished. The app already offers graphs, embedded content, structural validation, and simulation. Graphs with cycles are not executable yet, and work cycles will keep requiring explicit execution rules.

Our aim is to expand this foundation with readability, portability, and human authority as decision criteria. Every announced capability should be supported by something that can be inspected. Every aspiration should remain clearly identified as work still to be done.
