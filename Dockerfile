# Set up build
FROM node:lts@sha256:bdcdc627284297b040e2acc0bc9b27fa6578539d6e057925889690a7a9996fdf AS build
WORKDIR /usr/local/src/skill
COPY . ./

RUN npm ci --no-optional && \
    npm run compile && \
    rm -rf .git node_modules

FROM node:lts@sha256:d3d1a02bab20f7956676ff17e901f7c5054114a902a152cbebdf60cda362584f
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
