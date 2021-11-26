# Set up build
FROM node:lts@sha256:580a0850049c59a48f06090edd48c9f966c5e6572bbbabc369ba3ecbc4855dba AS build
WORKDIR /usr/local/src/skill
COPY . ./

RUN npm ci --no-optional && \
    npm run compile && \
    rm -rf .git node_modules

FROM node:lts@sha256:88ee7d2a5e18d359b4b5750ecb50a9b238ab467397c306aeb9955f4f11be44ce
WORKDIR "/skill"
COPY package.json package-lock.json ./
RUN npm ci --no-optional \
    && npm cache clean --force \
    && git clone https://github.com/tfutils/tfenv.git ~/.tfenv \
    && ln -s ~/.tfenv/bin/* /usr/local/bin \
    && tfenv install 0.12.26\
    && tfenv use

COPY --from=build /usr/local/src/skill .
WORKDIR "/atm/home"
ENTRYPOINT ["node", "--no-deprecation", "--trace-warnings", "--expose_gc", "--optimize_for_size", "--always_compact", "--max_old_space_size=2048", "/skill/node_modules/.bin/atm-skill"]
CMD ["run"]
